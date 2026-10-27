// What Flow remembers about the dictations: a history of the words (text only,
// never audio, the last 500, off with `keepHistory`) and, apart from it, the
// numbers of each day, which survive emptying the history. Two small JSON files
// in Peika's local folder (…\Peika\flow\, private on Linux), on this computer
// only. Port of upstream's flow/store.rs (FlowStore.swift) with the pieces Peika
// has: the history and the numbers, not the dictionary or the styles.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// The history never keeps more than this many dictations.
pub const MAX_ENTRIES: usize = 500;
/// How many days `flow_stats` returns.
pub const STATS_DAYS: usize = 30;

/// One dictation, kept for the history.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// Milliseconds since 1970.
    pub at: u64,
    /// The program it was pasted in ("slack"), when known.
    #[serde(default)]
    pub app: Option<String>,
    pub words: u64,
    /// How long it took, from the key going down.
    pub seconds: f64,
    pub text: String,
}

/// The numbers of one day. Kept even when the history is emptied.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct DayNumbers {
    pub dictations: u64,
    pub words: u64,
    pub seconds: f64,
}

/// One day of `flow_stats`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DayStats {
    /// "2026-10-14".
    pub date: String,
    pub dictations: u64,
    pub words: u64,
    pub seconds: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub today: DayStats,
    /// The last 30 days, oldest first, today last; a day without a dictation is zeros.
    pub days: Vec<DayStats>,
    /// Days in a row with a dictation, ending today (or yesterday, if today has none yet).
    pub streak: u32,
    /// Over the days above; 0 when there is nothing to measure.
    pub words_per_minute: u64,
}

/// Words as you would count them: "c'est" is one word, a lone "?" none.
pub fn word_count(s: &str) -> u64 {
    s.split_whitespace().filter(|w| w.chars().any(char::is_alphanumeric)).count() as u64
}

pub fn words_per_minute(words: u64, seconds: f64) -> u64 {
    if seconds < 1.0 || words == 0 {
        return 0;
    }
    (words as f64 / (seconds / 60.0)).round() as u64
}

/// A calendar day, without a time zone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Day {
    pub year: i32,
    pub month: u32,
    pub day: u32,
}

impl Day {
    /// "2026-10-14".
    pub fn key(self) -> String {
        format!("{:04}-{:02}-{:02}", self.year, self.month, self.day)
    }

    /// Days since 1970-01-01 (proleptic Gregorian).
    pub fn ordinal(self) -> i64 {
        let (y, m, d) = (self.year as i64, self.month as i64, self.day as i64);
        let y = if m <= 2 { y - 1 } else { y };
        let era = if y >= 0 { y } else { y - 399 } / 400;
        let yoe = y - era * 400;
        let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        era * 146_097 + doe - 719_468
    }

    pub fn from_ordinal(days: i64) -> Day {
        let z = days + 719_468;
        let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
        let doe = z - era * 146_097;
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
        let month = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
        let year = (yoe + era * 400 + if month <= 2 { 1 } else { 0 }) as i32;
        Day { year, month, day }
    }

    /// The day `n` days before.
    pub fn minus(self, n: i64) -> Day {
        Day::from_ordinal(self.ordinal() - n)
    }
}

pub fn today() -> Day {
    let t = crate::platform::local_time();
    Day { year: t.year as i32, month: t.month, day: t.day }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Days in a row with a dictation, ending today (or yesterday, if today has none yet).
pub fn streak(days: &HashSet<String>, today: Day) -> u32 {
    let mut day = today;
    if !days.contains(&day.key()) {
        day = day.minus(1);
    }
    let mut count = 0;
    while days.contains(&day.key()) {
        count += 1;
        day = day.minus(1);
    }
    count
}

pub struct Store {
    /// Newest first.
    history: Vec<Entry>,
    /// "2026-10-14" → that day's numbers.
    days: BTreeMap<String, DayNumbers>,
    folder: PathBuf,
}

fn load<T: serde::de::DeserializeOwned + Default>(folder: &Path, name: &str) -> T {
    std::fs::read_to_string(folder.join(name))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

impl Store {
    pub fn folder() -> PathBuf {
        crate::settings::local_dir().join("flow")
    }

    pub fn load_from(folder: PathBuf) -> Store {
        let mut history: Vec<Entry> = load(&folder, "history.json");
        history.truncate(MAX_ENTRIES);
        Store { history, days: load(&folder, "days.json"), folder }
    }

    fn save<T: Serialize>(&self, value: &T, name: &str) {
        let write = || -> std::io::Result<()> {
            crate::platform::ensure_private_dir(&self.folder)?;
            let text = serde_json::to_string(value).map_err(std::io::Error::other)?;
            let tmp = self.folder.join(format!("{name}.tmp"));
            std::fs::write(&tmp, text)?;
            std::fs::rename(&tmp, self.folder.join(name))
        };
        if let Err(err) = write() {
            crate::log::line(format!("flow: could not save {name}: {err}"));
        }
    }

    /// Counts a dictation and, when `keep`, keeps its text. Returns whether
    /// anything was counted (a dictation with no word in it is not).
    pub fn record(&mut self, text: &str, app: Option<&str>, seconds: f64, keep: bool, day: Day, now: u64) -> bool {
        let words = word_count(text);
        if words == 0 {
            return false;
        }
        let numbers = self.days.entry(day.key()).or_default();
        numbers.dictations += 1;
        numbers.words += words;
        numbers.seconds += seconds.max(0.0);
        self.save(&self.days, "days.json");
        if keep {
            let app = app.map(str::trim).filter(|a| !a.is_empty()).map(String::from);
            self.history.insert(0, Entry { at: now, app, words, seconds: seconds.max(0.0), text: text.trim().to_string() });
            self.history.truncate(MAX_ENTRIES);
            self.save(&self.history, "history.json");
        } else {
            self.forget_text();
        }
        true
    }

    /// Newest first.
    pub fn history(&self) -> Vec<Entry> {
        self.history.clone()
    }

    /// Drops the texts; the numbers stay.
    pub fn clear_history(&mut self) {
        self.history.clear();
        self.save(&self.history, "history.json");
    }

    /// `clear_history`, written only if there was something to drop: for
    /// `keepHistory` found off, which is checked at every read.
    pub fn forget_text(&mut self) {
        if !self.history.is_empty() {
            self.clear_history();
        }
    }

    pub fn stats(&self, today: Day) -> Stats {
        let at = |day: Day| {
            let numbers = self.days.get(&day.key()).cloned().unwrap_or_default();
            DayStats { date: day.key(), dictations: numbers.dictations, words: numbers.words, seconds: numbers.seconds }
        };
        let days: Vec<DayStats> = (0..STATS_DAYS as i64).rev().map(|back| at(today.minus(back))).collect();
        let (words, seconds) = days.iter().fold((0, 0.0), |(w, s), d| (w + d.words, s + d.seconds));
        let with_words: HashSet<String> = self.days.iter().filter(|(_, d)| d.words > 0).map(|(k, _)| k.clone()).collect();
        Stats {
            today: at(today),
            days,
            streak: streak(&with_words, today),
            words_per_minute: words_per_minute(words, seconds),
        }
    }
}

// ── The store the app uses ────────────────────────────────────────────────────

static STORE: Mutex<Option<Store>> = Mutex::new(None);

/// Runs `f` on the store, loaded from disk the first time it is needed.
fn with_store<T>(f: impl FnOnce(&mut Store) -> T) -> T {
    let mut guard: MutexGuard<Option<Store>> = STORE.lock().unwrap_or_else(|e| e.into_inner());
    f(guard.get_or_insert_with(|| Store::load_from(Store::folder())))
}

fn keeps_history(app: &AppHandle) -> bool {
    app.try_state::<crate::Shared>()
        .map(|shared| shared.settings.lock().unwrap_or_else(|e| e.into_inner()).flow.keep_history)
        .unwrap_or(true)
}

/// A dictation was pasted (or left on the clipboard): counted, and its text
/// kept unless the user turned the history off. `front` is the window it was
/// meant for; `seconds` how long it took.
pub fn record(app: &AppHandle, text: &str, front: Option<isize>, seconds: f64) {
    let keep = keeps_history(app);
    let program = front.and_then(super::os::app_of);
    with_store(|s| s.record(text, program.as_deref(), seconds, keep, today(), now_ms()));
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// The kept dictations, newest first. Empty (and the texts dropped) when the
/// history is off.
#[tauri::command]
pub fn flow_history(shared: tauri::State<'_, crate::Shared>) -> Vec<Entry> {
    let keep = shared.settings.lock().unwrap_or_else(|e| e.into_inner()).flow.keep_history;
    with_store(|s| {
        if keep {
            s.history()
        } else {
            s.forget_text();
            Vec::new()
        }
    })
}

#[tauri::command]
pub fn flow_stats() -> Stats {
    with_store(|s| s.stats(today()))
}

/// "Empty the history": the texts go, the numbers stay.
#[tauri::command]
pub fn flow_history_clear() {
    with_store(|s| s.clear_history());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder() -> PathBuf {
        static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        std::env::temp_dir().join(format!(
            "peika-flow-store-{}-{}",
            std::process::id(),
            N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ))
    }

    fn day(y: i32, m: u32, d: u32) -> Day {
        Day { year: y, month: m, day: d }
    }

    #[test]
    fn words_are_counted_as_a_person_would() {
        assert_eq!(word_count("bonjour à tous"), 3);
        assert_eq!(word_count("c'est bon"), 2);
        assert_eq!(word_count("?  ... "), 0);
        assert_eq!(word_count(""), 0);
    }

    #[test]
    fn days_convert_both_ways_and_cross_month_and_year_ends() {
        assert_eq!(day(1970, 1, 1).ordinal(), 0);
        assert_eq!(Day::from_ordinal(0), day(1970, 1, 1));
        assert_eq!(day(2026, 3, 1).minus(1), day(2026, 2, 28));
        assert_eq!(day(2028, 3, 1).minus(1), day(2028, 2, 29));
        assert_eq!(day(2026, 1, 1).minus(1), day(2025, 12, 31));
        for n in [-800, -1, 0, 1, 19_000, 20_000, 40_000] {
            assert_eq!(Day::from_ordinal(n).ordinal(), n);
        }
        assert_eq!(day(2026, 10, 4).key(), "2026-10-04");
    }

    #[test]
    fn the_streak_counts_days_in_a_row_ending_today_or_yesterday() {
        let set = |keys: &[&str]| keys.iter().map(|k| k.to_string()).collect::<HashSet<_>>();
        let today = day(2026, 10, 14);
        assert_eq!(streak(&set(&[]), today), 0);
        assert_eq!(streak(&set(&["2026-10-14", "2026-10-13", "2026-10-12"]), today), 3);
        // Nothing yet today: yesterday's run still counts.
        assert_eq!(streak(&set(&["2026-10-13", "2026-10-12"]), today), 2);
        // A gap ends it.
        assert_eq!(streak(&set(&["2026-10-14", "2026-10-12"]), today), 1);
        assert_eq!(streak(&set(&["2026-10-11"]), today), 0);
    }

    #[test]
    fn words_per_minute_needs_something_to_measure() {
        assert_eq!(words_per_minute(120, 60.0), 120);
        assert_eq!(words_per_minute(30, 20.0), 90);
        assert_eq!(words_per_minute(5, 0.5), 0);
        assert_eq!(words_per_minute(0, 30.0), 0);
    }

    #[test]
    fn a_dictation_is_kept_newest_first_and_counted() {
        let dir = folder();
        let mut s = Store::load_from(dir.clone());
        let today = day(2026, 10, 14);
        assert!(s.record("bonjour à tous", Some("slack"), 2.0, true, today, 1_000));
        assert!(s.record("  second one ", Some(" "), 4.0, true, today, 2_000));
        // Nothing to count: neither counted nor kept.
        assert!(!s.record("?", None, 1.0, true, today, 3_000));
        let history = s.history();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].text, "second one");
        assert_eq!(history[0].app, None);
        assert_eq!(history[1].app.as_deref(), Some("slack"));
        assert_eq!((history[1].words, history[1].at), (3, 1_000));
        let stats = s.stats(today);
        assert_eq!((stats.today.dictations, stats.today.words, stats.today.seconds), (2, 5, 6.0));
        assert_eq!(stats.streak, 1);
        assert_eq!(stats.words_per_minute, 50);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn at_most_500_are_kept_and_the_numbers_still_count_them_all() {
        let dir = folder();
        let mut s = Store::load_from(dir.clone());
        let today = day(2026, 10, 14);
        for i in 0..(MAX_ENTRIES + 20) {
            s.record(&format!("word{i}"), None, 1.0, true, today, i as u64);
        }
        let history = s.history();
        assert_eq!(history.len(), MAX_ENTRIES);
        assert_eq!(history[0].text, format!("word{}", MAX_ENTRIES + 19));
        assert_eq!(history.last().unwrap().text, "word20");
        assert_eq!(s.stats(today).today.dictations, (MAX_ENTRIES + 20) as u64);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn emptying_the_history_keeps_the_numbers() {
        let dir = folder();
        let mut s = Store::load_from(dir.clone());
        let today = day(2026, 10, 14);
        s.record("one two three", Some("code"), 3.0, true, today, 1);
        s.clear_history();
        assert!(s.history().is_empty());
        assert_eq!(s.stats(today).today.words, 3);
        // On disk too.
        let again = Store::load_from(dir.clone());
        assert!(again.history().is_empty());
        assert_eq!(again.stats(today).today.dictations, 1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn with_the_history_off_only_the_numbers_are_kept_and_old_texts_go() {
        let dir = folder();
        let mut s = Store::load_from(dir.clone());
        let today = day(2026, 10, 14);
        s.record("kept before", None, 1.0, true, today, 1);
        s.record("not kept", Some("slack"), 2.0, false, today, 2);
        assert!(s.history().is_empty());
        assert_eq!(s.stats(today).today.dictations, 2);
        let on_disk = std::fs::read_to_string(dir.join("history.json")).unwrap();
        assert!(!on_disk.contains("kept"), "the text must not be left in the file: {on_disk}");
        let numbers = std::fs::read_to_string(dir.join("days.json")).unwrap();
        assert!(!numbers.contains("not kept"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_stats_cover_the_last_30_days_oldest_first() {
        let dir = folder();
        let mut s = Store::load_from(dir.clone());
        let today = day(2026, 10, 14);
        s.record("a b", None, 2.0, true, day(2026, 10, 13), 1);
        s.record("c d e", None, 3.0, true, day(2026, 10, 14), 2);
        // Older than the window: not in the days, not in the streak's reach.
        s.record("old", None, 1.0, true, day(2026, 8, 1), 0);
        let stats = s.stats(today);
        assert_eq!(stats.days.len(), STATS_DAYS);
        assert_eq!(stats.days[0].date, "2026-09-15");
        assert_eq!(stats.days[STATS_DAYS - 1].date, "2026-10-14");
        assert_eq!(stats.days[STATS_DAYS - 2].words, 2);
        assert_eq!(stats.days[0].dictations, 0);
        assert_eq!(stats.streak, 2);
        assert_eq!(stats.words_per_minute, 60);
        let json = serde_json::to_value(&stats).unwrap();
        assert!(json["wordsPerMinute"].is_number() && json["today"]["date"] == "2026-10-14");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn files_that_are_missing_or_broken_read_as_empty() {
        let dir = folder();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("history.json"), "not json").unwrap();
        let s = Store::load_from(dir.clone());
        assert!(s.history().is_empty());
        assert_eq!(s.stats(day(2026, 10, 14)).streak, 0);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn an_entry_reads_back_as_the_page_expects_it() {
        let entry = Entry { at: 5, app: Some("slack".into()), words: 2, seconds: 1.5, text: "hi there".into() };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json, serde_json::json!({ "at": 5, "app": "slack", "words": 2, "seconds": 1.5, "text": "hi there" }));
        let old: Entry = serde_json::from_str(r#"{"at":1,"words":1,"seconds":0.5,"text":"x"}"#).unwrap();
        assert_eq!(old.app, None);
    }
}
