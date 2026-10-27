// How the words are written, by the app that is in front when the key goes
// down (the Mac's FlowStore styles). Local rules only, no model:
//
// - verbatim: the words as heard, for code editors, terminals and AI chats,
//   where a capital or a full stop is in the way;
// - clean (the default): without "um" and "uh", a capital to begin, a full stop
//   to end;
// - sentences: clean, and every sentence capitalised and closed, for mail.
//
// The built-in table maps an executable to a style; the user's own entries
// (Settings → Flow dictation → Styles) win over it. Pure: the app's name comes
// from the OS (os_windows.rs `app_of`), and nothing here touches it.

/// A snippet's mark begins and ends with these (text.rs); a style leaves a mark
/// alone, since it stands for text the user wrote and wants as it is.
pub const MARK_OPEN: char = '⟦';
pub const MARK_CLOSE: char = '⟧';

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Style {
    Verbatim,
    Clean,
    Sentences,
}

impl Style {
    /// A style as the settings write it; one this build does not know is clean.
    pub fn from_setting(name: &str) -> Style {
        match name.trim().to_lowercase().as_str() {
            "verbatim" => Style::Verbatim,
            "sentences" => Style::Sentences,
            _ => Style::Clean,
        }
    }
}

/// An app's name as a key: the executable without ".exe", in lower case
/// ("WindowsTerminal.exe" → "windowsterminal").
pub fn app_key(name: &str) -> String {
    let lower = name.trim().to_lowercase();
    lower.strip_suffix(".exe").unwrap_or(&lower).trim().to_string()
}

/// What an app gets when the user has said nothing about it.
fn built_in(app: &str) -> Style {
    match app {
        // Code editors, terminals and AI chats: whatever is said goes in as said.
        "code" | "code - insiders" | "cursor" | "windsurf" | "antigravity" | "zed" | "sublime_text" | "devenv"
        | "idea64" | "pycharm64" | "webstorm64" | "rider64" | "clion64" | "goland64" | "rustrover64"
        | "windowsterminal" | "wt" | "powershell" | "pwsh" | "cmd" | "conhost" | "wezterm-gui" | "alacritty"
        | "mintty" | "kitty" | "gnome-terminal-server" | "konsole" | "xterm" | "claude" | "chatgpt" | "codex" => {
            Style::Verbatim
        }
        // Mail.
        "outlook" | "olk" | "hxoutlook" | "thunderbird" | "mailspring" | "emclient" => Style::Sentences,
        _ => Style::Clean,
    }
}

/// The style for the app in front: the user's entry for it, else the built-in
/// one, else clean. `None` (no window could be told) is clean.
pub fn style_for(app: Option<&str>, own: &[(String, String)]) -> Style {
    let Some(app) = app.map(app_key).filter(|a| !a.is_empty()) else { return Style::Clean };
    own.iter()
        .rev() // the last entry for an app is the one that stands
        .find(|(name, _)| app_key(name) == app)
        .map(|(_, style)| Style::from_setting(style))
        .unwrap_or_else(|| built_in(&app))
}

/// What is said to fill a pause, in the languages Flow hears most. Words that
/// are also real words somewhere ("er" is German for "he") are left out.
fn is_filler(word: &str) -> bool {
    matches!(
        word,
        "um" | "umm" | "uh" | "uhh" | "uhm" | "erm" | "hm" | "hmm" | "hmmm" | "mm" | "mmm" | "euh" | "euhh" | "heu"
    )
}

/// The word with the punctuation around it taken off, in lower case.
fn core(word: &str) -> String {
    word.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase()
}

fn ends_a_sentence(word: &str) -> bool {
    word.ends_with(['.', '!', '?', '…'])
}

/// One line without its fillers. A filler's comma goes with it; its full stop,
/// question or exclamation mark is kept, handed to the word before ("so, uh."
/// → "so.").
fn without_fillers(line: &str) -> String {
    let mut kept: Vec<String> = Vec::new();
    for word in line.split_whitespace() {
        if is_filler(&core(word)) {
            if let Some(end) = word.chars().rev().take_while(|c| !c.is_alphanumeric()).find(|c| matches!(c, '.' | '!' | '?' | '…')) {
                if let Some(last) = kept.last_mut() {
                    if !ends_a_sentence(last) {
                        let trimmed = last.trim_end_matches([',', ';', ':']).len();
                        last.truncate(trimmed);
                        last.push(end);
                    }
                }
            }
            continue;
        }
        kept.push(word.to_string());
    }
    kept.join(" ")
}

fn is_cjk(c: char) -> bool {
    matches!(c as u32, 0x2E80..=0x9FFF | 0xAC00..=0xD7AF | 0xF900..=0xFAFF | 0xFF00..=0xFFEF)
}

/// Words that end in a full stop without ending the sentence: "e.g.", "Dr.".
fn is_abbreviation(word: &str) -> bool {
    let word = word.trim_end_matches('.');
    word.contains('.') || matches!(word.to_lowercase().as_str(), "mr" | "mrs" | "ms" | "dr" | "prof" | "vs" | "st")
}

fn upper_first(word: &str) -> String {
    let mut chars = word.chars();
    match chars.next() {
        Some(first) if first.is_lowercase() => first.to_uppercase().chain(chars).collect(),
        _ => word.to_string(),
    }
}

/// Capitals: the first word of the text, and with `every_sentence` the first
/// of each sentence too. A word that starts with a mark, a digit or a symbol is
/// left as it is.
fn capitals(line: &str, every_sentence: bool) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut start = true;
    for word in line.split(' ') {
        let lead = word.trim_start_matches(['"', '“', '«', '(', '¿', '¡']);
        let skip = word.len() - lead.len();
        let cased = if start && !lead.starts_with(MARK_OPEN) { format!("{}{}", &word[..skip], upper_first(lead)) } else { word.to_string() };
        if !word.is_empty() {
            start = every_sentence && ends_a_sentence(word.trim_end_matches(['"', '”', '»', ')'])) && !is_abbreviation(word);
        }
        out.push(cased);
    }
    out.join(" ")
}

/// A full stop at the end of a line that has none. Not after a mark (the
/// snippet's text ends as its author wrote it), not after Chinese or Japanese.
fn closed(line: &str, sentences: bool) -> String {
    let line = line.trim_end();
    if sentences && line.ends_with([',', ';']) {
        return format!("{}.", line.trim_end_matches([',', ';']));
    }
    match line.chars().last() {
        Some(last) if last.is_alphanumeric() && !is_cjk(last) => format!("{line}."),
        // A closing quote or bracket after a word.
        Some('"' | '”' | '»' | ')') if line.chars().rev().nth(1).is_some_and(|c| c.is_alphanumeric() && !is_cjk(c)) => {
            format!("{line}.")
        }
        _ => line.to_string(),
    }
}

/// `text` written the way `style` says. Line by line, so that a line break
/// the engine gave stays.
pub fn tidy(text: &str, style: Style) -> String {
    if style == Style::Verbatim {
        return text.trim().to_string();
    }
    let sentences = style == Style::Sentences;
    let lines: Vec<String> = text
        .trim()
        .split('\n')
        .map(|line| without_fillers(line))
        .filter(|line| !line.is_empty())
        .collect();
    let last = lines.len().saturating_sub(1);
    lines
        .iter()
        .enumerate()
        .map(|(i, line)| {
            let line = capitals(line, sentences);
            // The text ends once; a line break in the middle is the speaker's own.
            if i == last || sentences { closed(&line, sentences) } else { line }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn own(entries: &[(&str, &str)]) -> Vec<(String, String)> {
        entries.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect()
    }

    #[test]
    fn an_app_is_known_by_its_executable_in_lower_case() {
        assert_eq!(app_key("WindowsTerminal.exe"), "windowsterminal");
        assert_eq!(app_key("  Slack "), "slack");
        assert_eq!(app_key("Code - Insiders"), "code - insiders");
        assert_eq!(app_key(".exe"), "");
    }

    #[test]
    fn code_terminals_and_ai_chats_are_verbatim_and_mail_is_sentences() {
        for app in ["Code", "Cursor", "WindowsTerminal", "powershell", "cmd", "claude", "pwsh"] {
            assert_eq!(style_for(Some(app), &[]), Style::Verbatim, "{app}");
        }
        for app in ["OUTLOOK", "Thunderbird", "olk"] {
            assert_eq!(style_for(Some(app), &[]), Style::Sentences, "{app}");
        }
        for app in ["notepad", "slack", "chrome"] {
            assert_eq!(style_for(Some(app), &[]), Style::Clean, "{app}");
        }
        assert_eq!(style_for(None, &[]), Style::Clean);
        assert_eq!(style_for(Some(""), &[]), Style::Clean);
    }

    #[test]
    fn the_user_s_entry_wins_over_the_built_in_one() {
        let mine = own(&[("Code.exe", "clean"), ("slack", "sentences")]);
        assert_eq!(style_for(Some("code"), &mine), Style::Clean);
        assert_eq!(style_for(Some("slack"), &mine), Style::Sentences);
        assert_eq!(style_for(Some("cursor"), &mine), Style::Verbatim);
        // Twice for one app: the later one stands. A style nobody knows is clean.
        let twice = own(&[("slack", "verbatim"), ("slack", "sentences")]);
        assert_eq!(style_for(Some("slack"), &twice), Style::Sentences);
        assert_eq!(style_for(Some("slack"), &own(&[("slack", "poetic")])), Style::Clean);
    }

    #[test]
    fn verbatim_only_trims() {
        assert_eq!(tidy("  um git status \n", Style::Verbatim), "um git status");
    }

    #[test]
    fn clean_drops_the_fillers_and_gives_a_capital_and_a_full_stop() {
        assert_eq!(tidy("um so i think uh we should go", Style::Clean), "So i think we should go.");
        assert_eq!(tidy("euh je pense que, euh, oui", Style::Clean), "Je pense que, oui.");
        assert_eq!(tidy("Um, hello there", Style::Clean), "Hello there.");
        assert_eq!(tidy("Hmm... okay", Style::Clean), "Okay.");
        // Words that only look like one stay.
        assert_eq!(tidy("the umbrella is humming", Style::Clean), "The umbrella is humming.");
    }

    #[test]
    fn a_filler_s_full_stop_is_handed_to_the_word_before() {
        assert_eq!(tidy("that is it, uh.", Style::Clean), "That is it.");
        assert_eq!(tidy("really? um", Style::Clean), "Really?");
    }

    #[test]
    fn an_end_the_speaker_gave_is_kept() {
        assert_eq!(tidy("is it done?", Style::Clean), "Is it done?");
        assert_eq!(tidy("yes!", Style::Clean), "Yes!");
        assert_eq!(tidy("the options are:", Style::Clean), "The options are:");
        assert_eq!(tidy("he said \"go\"", Style::Clean), "He said \"go\".");
    }

    #[test]
    fn nothing_is_added_after_chinese_or_japanese() {
        assert_eq!(tidy("今天天气很好", Style::Clean), "今天天气很好");
        assert_eq!(tidy("今日は天気です。", Style::Sentences), "今日は天気です。");
    }

    #[test]
    fn clean_leaves_the_words_after_the_first_as_they_are() {
        assert_eq!(tidy("hello. how are you", Style::Clean), "Hello. how are you.");
    }

    #[test]
    fn sentences_capitalise_and_close_every_sentence() {
        assert_eq!(
            tidy("hello john. thanks for the file! can you send it again? i will wait", Style::Sentences),
            "Hello john. Thanks for the file! Can you send it again? I will wait."
        );
        assert_eq!(tidy("thanks, see you tomorrow,", Style::Sentences), "Thanks, see you tomorrow.");
    }

    #[test]
    fn sentences_do_not_start_a_new_one_after_an_abbreviation() {
        assert_eq!(tidy("ask dr. smith about it", Style::Sentences), "Ask dr. smith about it.");
        assert_eq!(tidy("see e.g. the file", Style::Sentences), "See e.g. the file.");
        assert_eq!(tidy("so do i. then we go", Style::Sentences), "So do i. Then we go.");
    }

    #[test]
    fn lines_the_engine_gave_are_kept() {
        assert_eq!(tidy("dear paul\nsee you soon", Style::Clean), "Dear paul\nSee you soon.");
        assert_eq!(tidy("dear paul\nsee you soon", Style::Sentences), "Dear paul.\nSee you soon.");
        assert_eq!(tidy("um\n\nhello", Style::Clean), "Hello.");
    }

    #[test]
    fn a_snippet_s_mark_is_not_capitalised_or_closed() {
        let mark = "⟦peikasnippet0⟧";
        assert_eq!(tidy(mark, Style::Clean), mark);
        assert_eq!(tidy(&format!("send it to {mark}"), Style::Sentences), format!("Send it to {mark}"));
        assert_eq!(tidy(&format!("{mark} is where i live"), Style::Clean), format!("{mark} is where i live."));
    }

    #[test]
    fn nothing_to_write_gives_nothing() {
        assert_eq!(tidy("", Style::Clean), "");
        assert_eq!(tidy("  um uh  ", Style::Sentences), "");
    }
}
