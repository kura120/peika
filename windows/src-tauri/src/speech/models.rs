// The hearing model, loaded once and kept a while, for voice and for dictation.
//
// The model is big (Parakeet is 622 MB) and the memory goes with it, so nobody
// holds it from the start: whoever needs it takes it (loaded now when none is
// kept), and gives it back when done. It is kept for `KEPT_FOR` after the last
// give-back, for whoever comes next, then let go. Voice and dictation share
// this one copy.
//
// The keeping is `Holder`, generic over what it keeps so that its tests need
// no engine; the one the app uses holds the real `Engine`.
//
// Known and accepted: a dictation that starts while voice still holds the
// model loads a second copy for a moment. Both are given back to this one
// holder afterwards, and it keeps only the last.

#![cfg_attr(not(windows), allow(dead_code))]

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

/// How long the model stays loaded after its last use.
const KEPT_FOR: Duration = Duration::from_secs(120);

/// A kept item, and which model it is.
pub struct Held<T> {
    pub item: T,
    which: usize,
}

pub struct Holder<T> {
    kept: Mutex<Option<Held<T>>>,
    /// Bumped by every take and give-back: a timer that finds it changed
    /// knows the item it was started for has been used since, and leaves it.
    generation: AtomicU64,
    keep: Duration,
    /// Told when a kept item is dropped (the log's line).
    let_go: fn(),
}

impl<T: Send + 'static> Holder<T> {
    pub const fn new(keep: Duration, let_go: fn()) -> Self {
        Self { kept: Mutex::new(None), generation: AtomicU64::new(0), keep, let_go }
    }

    fn kept(&self) -> MutexGuard<'_, Option<Held<T>>> {
        self.kept.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The kept item if it is `which`, else one loaded now. A load that fails
    /// is the caller's to report, and nothing is kept for it.
    pub fn take(&self, which: usize, load: impl FnOnce() -> Result<T, String>) -> Result<Held<T>, String> {
        self.generation.fetch_add(1, Ordering::SeqCst);
        let kept = self.kept().take();
        if let Some(kept) = kept {
            if kept.which == which {
                return Ok(kept);
            }
            // Another model was chosen since: this one is of no use.
            drop(kept);
            (self.let_go)();
        }
        load().map(|item| Held { item, which })
    }

    /// Kept for `keep`, then dropped unless someone took it meanwhile.
    pub fn give_back(&'static self, held: Held<T>) {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        // A second copy (see the top): the one given back earlier is let go.
        let older = self.kept().replace(held);
        if older.is_some() {
            drop(older);
            (self.let_go)();
        }
        let keep = self.keep;
        let timer = std::thread::Builder::new().name("hearing-kept".into()).spawn(move || {
            std::thread::sleep(keep);
            self.let_go_if(generation);
        });
        // No timer, no keeping: better to reload one day than to hold 600 MB forever.
        if timer.is_err() {
            self.let_go_if(generation);
        }
    }

    fn let_go_if(&self, generation: u64) {
        let mut kept = self.kept();
        // Looked at under the lock: a take that comes after finds it empty and loads.
        let item = if self.generation.load(Ordering::SeqCst) == generation { kept.take() } else { None };
        drop(kept);
        if item.is_some() {
            drop(item);
            (self.let_go)();
        }
    }
}

#[cfg(windows)]
pub use real::{give_back, take, Loaded};

#[cfg(windows)]
mod real {
    use std::time::Instant;

    use super::{Held, Holder, KEPT_FOR};
    use crate::speech::engine;
    use crate::speech::sherpa::Engine;

    pub type Loaded = Held<Engine>;

    static HOLDER: Holder<Engine> = Holder::new(KEPT_FOR, let_go);

    fn let_go() {
        crate::log::line("voice: hearing model let go");
    }

    fn chosen() -> usize {
        engine::HEARING_MODELS.iter().position(|m| std::ptr::eq(m, engine::hearing())).unwrap_or(0)
    }

    /// The kept model if it is still the chosen one, else loaded now.
    pub fn take() -> Result<Loaded, String> {
        HOLDER.take(chosen(), || {
            let started = Instant::now();
            let model = engine::hearing();
            let engine = Engine::load(&engine::runtime_dir(), &engine::model_dir(engine::Part::Hearing), model.family)?;
            // How long it took, never what it heard.
            crate::log::line(format!("voice: hearing model loaded ({} ms)", started.elapsed().as_millis()));
            Ok(engine)
        })
    }

    /// Kept for a while, then let go if nobody took it meanwhile.
    pub fn give_back(model: Loaded) {
        HOLDER.give_back(model);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;
    use std::sync::Arc;
    use std::thread::sleep;

    use super::*;

    /// A holder for a test, with a short keep time, and how often it was
    /// loaded and let go. Leaked: `give_back` wants it to live for ever.
    fn holder(keep_ms: u64) -> &'static Holder<usize> {
        Box::leak(Box::new(Holder::new(Duration::from_millis(keep_ms), || {})))
    }

    fn loader(loads: &Arc<AtomicUsize>) -> impl FnOnce() -> Result<usize, String> {
        let loads = loads.clone();
        move || Ok(loads.fetch_add(1, Ordering::SeqCst) + 1)
    }

    #[test]
    fn a_model_given_back_and_taken_again_in_time_is_the_same_one() {
        let (holder, loads) = (holder(5_000), Arc::new(AtomicUsize::new(0)));
        let first = holder.take(0, loader(&loads)).unwrap();
        assert_eq!(first.item, 1);
        holder.give_back(first);
        let again = holder.take(0, loader(&loads)).unwrap();
        assert_eq!((again.item, loads.load(Ordering::SeqCst)), (1, 1), "loaded once, taken twice");
    }

    #[test]
    fn a_model_left_alone_past_the_keep_time_is_dropped() {
        let (holder, loads) = (holder(20), Arc::new(AtomicUsize::new(0)));
        let first = holder.take(0, loader(&loads)).unwrap();
        holder.give_back(first);
        sleep(Duration::from_millis(300));
        let again = holder.take(0, loader(&loads)).unwrap();
        assert_eq!((again.item, loads.load(Ordering::SeqCst)), (2, 2), "loaded again");
    }

    #[test]
    fn the_timer_of_an_earlier_give_back_does_not_undo_a_later_one() {
        let (holder, loads) = (holder(300), Arc::new(AtomicUsize::new(0)));
        let first = holder.take(0, loader(&loads)).unwrap();
        holder.give_back(first);
        sleep(Duration::from_millis(100));
        // Taken and given back again: the first timer (at 300 ms) is stale.
        let used = holder.take(0, loader(&loads)).unwrap();
        holder.give_back(used);
        sleep(Duration::from_millis(250));
        let again = holder.take(0, loader(&loads)).unwrap();
        assert_eq!((again.item, loads.load(Ordering::SeqCst)), (1, 1), "still the first, not reloaded");
    }

    #[test]
    fn a_take_is_not_undone_by_a_pending_timer() {
        let (holder, loads) = (holder(100), Arc::new(AtomicUsize::new(0)));
        let first = holder.take(0, loader(&loads)).unwrap();
        holder.give_back(first);
        let taken = holder.take(0, loader(&loads)).unwrap();
        sleep(Duration::from_millis(300));
        // The timer ran while it was out: nothing of it was dropped, nothing is kept.
        assert_eq!(taken.item, 1);
        assert!(holder.kept().is_none());
        holder.give_back(taken);
        assert!(holder.kept().is_some());
    }

    #[test]
    fn another_chosen_model_is_not_reused() {
        let (holder, loads) = (holder(5_000), Arc::new(AtomicUsize::new(0)));
        let first = holder.take(0, loader(&loads)).unwrap();
        holder.give_back(first);
        let other = holder.take(1, loader(&loads)).unwrap();
        assert_eq!((other.item, loads.load(Ordering::SeqCst)), (2, 2));
    }

    #[test]
    fn a_load_that_fails_is_reported_and_keeps_nothing() {
        let (holder, loads) = (holder(5_000), Arc::new(AtomicUsize::new(0)));
        let first = holder.take(0, loader(&loads)).unwrap();
        holder.give_back(first);
        // The kept one is another model: it goes, and the new one does not load.
        let failed = holder.take(1, || Err("no such file".to_string()));
        assert_eq!(failed.err().as_deref(), Some("no such file"));
        assert!(holder.kept().is_none());
        let again = holder.take(0, loader(&loads)).unwrap();
        assert_eq!(again.item, 2, "loaded again: nothing was kept");
    }
}
