// The bundled hearing model, as voice holds it: not at all until a command is
// coming, loaded on a helper thread meanwhile, here once it has arrived.
//
// The listener thread must go on reading the microphone while the model loads
// (a second or two for a big one), so a load is started on a thread of its
// own and the result comes back on a channel. The model itself is the shared
// holder's (speech/models.rs); this is only voice's side of it, generic over
// what it holds so that its tests need no engine.

#![cfg_attr(not(windows), allow(dead_code))]

use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::time::Duration;

enum State<T> {
    /// Not loaded, nor being loaded.
    Away,
    /// On its way, from a helper thread.
    Loading(Receiver<Result<T, String>>),
    Here(T),
}

/// Why the model could not be had just now.
#[derive(Debug, PartialEq)]
pub enum Unready {
    /// The wait ran out and the load goes on: the next sentence may find it.
    NotYet,
    /// The load failed, or its thread is gone: nothing is coming.
    Failed(String),
}

pub struct Bundled<T: Send + 'static> {
    state: State<T>,
    load: Arc<dyn Fn() -> Result<T, String> + Send + Sync>,
    give_back: Arc<dyn Fn(T) + Send + Sync>,
}

impl<T: Send + 'static> Bundled<T> {
    pub fn new(load: Arc<dyn Fn() -> Result<T, String> + Send + Sync>, give_back: Arc<dyn Fn(T) + Send + Sync>) -> Self {
        Self { state: State::Away, load, give_back }
    }

    /// Starts loading it, if it is neither here nor on its way. Returns at
    /// once.
    pub fn start(&mut self) {
        if !matches!(self.state, State::Away) {
            return;
        }
        let (tx, rx) = mpsc::channel();
        let (load, give_back) = (self.load.clone(), self.give_back.clone());
        let spawned = std::thread::Builder::new().name("hearing-load".into()).spawn(move || {
            // Nobody waits for it any more (listening ended meanwhile): the
            // thread that loaded it gives it back itself, so it is neither
            // leaked nor held for ever.
            if let Err(mpsc::SendError(Ok(item))) = tx.send(load()) {
                give_back(item);
            }
        });
        // No thread: it is taken when a sentence needs it, as if never started.
        if spawned.is_ok() {
            self.state = State::Loading(rx);
        }
    }

    /// The model: waiting up to `wait` for it, whether it was already on its
    /// way or is started now (so the wait covers every path, and the listener
    /// is never held by a load that has no end). A wait that runs out leaves
    /// it coming, for the next sentence. Why it cannot be had is for the
    /// caller to log.
    pub fn get(&mut self, wait: Duration) -> Result<&T, Unready> {
        if matches!(self.state, State::Away) {
            self.start();
            // Only when no thread could be made: loaded here, on this one, as
            // the last resort (nothing else can load it).
            if matches!(self.state, State::Away) {
                self.state = State::Here((self.load)().map_err(Unready::Failed)?);
            }
        }
        if matches!(self.state, State::Loading(_)) {
            if let State::Loading(rx) = std::mem::replace(&mut self.state, State::Away) {
                match rx.recv_timeout(wait) {
                    Ok(Ok(item)) => self.state = State::Here(item),
                    Ok(Err(why)) => return Err(Unready::Failed(why)),
                    Err(RecvTimeoutError::Timeout) => {
                        self.state = State::Loading(rx);
                        return Err(Unready::NotYet);
                    }
                    Err(RecvTimeoutError::Disconnected) => return Err(Unready::Failed("its loading stopped".into())),
                }
            }
        }
        match &self.state {
            State::Here(item) => Ok(item),
            _ => Err(Unready::Failed("it is not here".into())),
        }
    }

    /// Listening is done with it: back to the holder, which keeps it a while.
    pub fn release(&mut self) {
        match std::mem::replace(&mut self.state, State::Away) {
            State::Here(item) => (self.give_back)(item),
            // Dropping the channel is what tells the loading thread.
            State::Loading(_) | State::Away => {}
        }
    }

    #[cfg(test)]
    fn here(&self) -> bool {
        matches!(self.state, State::Here(_))
    }

    #[cfg(test)]
    fn loading(&self) -> bool {
        matches!(self.state, State::Loading(_))
    }
}

impl<T: Send + 'static> Drop for Bundled<T> {
    /// Turning voice off gives it back rather than dropping it: turned on
    /// again within the keep time, it is not loaded twice.
    fn drop(&mut self) {
        self.release();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::thread::sleep;
    use std::time::Instant;

    use super::*;

    /// A fake model that takes `ms` to load, counting loads and give-backs.
    fn fake(ms: u64, fail: bool) -> (Bundled<usize>, Arc<AtomicUsize>, Arc<AtomicUsize>) {
        let (loads, given) = (Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)));
        let (l, g) = (loads.clone(), given.clone());
        let load = move || {
            sleep(Duration::from_millis(ms));
            if fail {
                return Err("no such file".to_string());
            }
            Ok(l.fetch_add(1, Ordering::SeqCst) + 1)
        };
        let give_back = move |_| {
            g.fetch_add(1, Ordering::SeqCst);
        };
        (Bundled::new(Arc::new(load), Arc::new(give_back)), loads, given)
    }

    fn wait_for(count: &AtomicUsize, at_least: usize) -> bool {
        let until = Instant::now() + Duration::from_secs(3);
        while count.load(Ordering::SeqCst) < at_least && Instant::now() < until {
            sleep(Duration::from_millis(10));
        }
        count.load(Ordering::SeqCst) >= at_least
    }

    #[test]
    fn started_on_a_command_it_is_ready_by_the_time_it_is_needed() {
        // A load of 500 ms: starting it must not take a tenth of that.
        let (mut model, loads, _) = fake(500, false);
        let started = Instant::now();
        model.start();
        assert!(started.elapsed() < Duration::from_millis(50), "start does not wait for the load");
        assert!(model.loading() && !model.here());
        assert_eq!(model.get(Duration::from_secs(3)).copied(), Ok(1));
        assert!(model.here());
        // Started again while here: nothing more is loaded.
        model.start();
        assert_eq!((model.get(Duration::ZERO).copied(), loads.load(Ordering::SeqCst)), (Ok(1), 1));
    }

    #[test]
    fn a_wait_that_runs_out_leaves_it_coming() {
        // A wait of 20 ms against a load of 500 ms.
        let (mut model, _, _) = fake(500, false);
        model.start();
        assert_eq!(model.get(Duration::from_millis(20)).copied(), Err(Unready::NotYet));
        assert!(model.loading(), "still coming");
        // The next sentence finds it.
        assert_eq!(model.get(Duration::from_secs(5)).copied(), Ok(1));
    }

    #[test]
    fn a_model_not_started_is_loaded_on_the_helper_thread_within_the_wait() {
        let (mut model, loads, _) = fake(10, false);
        assert_eq!(model.get(Duration::from_secs(5)).copied(), Ok(1));
        assert_eq!(loads.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_model_not_started_and_slower_than_the_wait_is_not_yet_not_a_hang() {
        let (mut model, _, _) = fake(500, false);
        let asked = Instant::now();
        assert_eq!(model.get(Duration::from_millis(20)).copied(), Err(Unready::NotYet));
        assert!(asked.elapsed() < Duration::from_millis(250), "the wait was kept to");
        assert!(model.loading());
        assert_eq!(model.get(Duration::from_secs(5)).copied(), Ok(1));
    }

    #[test]
    fn a_failed_load_is_reported_once() {
        let (mut model, _, _) = fake(10, true);
        model.start();
        assert_eq!(model.get(Duration::from_secs(5)).copied(), Err(Unready::Failed("no such file".into())));
        // Not here and not coming: nothing waits on it, nothing is reported again.
        assert!(!model.here() && !model.loading());
    }

    #[test]
    fn released_it_goes_back_to_the_holder() {
        let (mut model, _, given) = fake(0, false);
        assert!(model.get(Duration::from_secs(1)).is_ok());
        model.release();
        assert_eq!(given.load(Ordering::SeqCst), 1);
        assert!(!model.here());
        // Released twice: nothing to give.
        model.release();
        assert_eq!(given.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn one_released_while_loading_is_given_back_by_the_thread_that_loaded_it() {
        let (mut model, loads, given) = fake(100, false);
        model.start();
        model.release();
        assert!(wait_for(&given, 1), "given back when it arrived");
        assert_eq!(loads.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn dropped_it_is_given_back() {
        let (mut model, _, given) = fake(0, false);
        assert!(model.get(Duration::from_secs(1)).is_ok());
        drop(model);
        assert_eq!(given.load(Ordering::SeqCst), 1);
    }
}
