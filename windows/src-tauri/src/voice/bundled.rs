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

    /// The model: waiting up to `wait` for one on its way, loading it now
    /// when it is not coming. A wait that runs out leaves it coming, for the
    /// next sentence. Why it cannot be had is for the caller to log.
    pub fn get(&mut self, wait: Duration) -> Result<&T, String> {
        match std::mem::replace(&mut self.state, State::Away) {
            State::Here(item) => self.state = State::Here(item),
            State::Loading(rx) => match rx.recv_timeout(wait) {
                Ok(Ok(item)) => self.state = State::Here(item),
                Ok(Err(why)) => return Err(why),
                Err(RecvTimeoutError::Timeout) => {
                    self.state = State::Loading(rx);
                    return Err("it was not ready in time".into());
                }
                Err(RecvTimeoutError::Disconnected) => return Err("its loading stopped".into()),
            },
            State::Away => self.state = State::Here((self.load)()?),
        }
        match &self.state {
            State::Here(item) => Ok(item),
            _ => Err("it is not here".into()),
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
        let (mut model, loads, _) = fake(150, false);
        let started = Instant::now();
        model.start();
        assert!(started.elapsed() < Duration::from_millis(100), "start does not wait for the load");
        assert!(model.loading() && !model.here());
        assert_eq!(model.get(Duration::from_secs(3)).copied(), Ok(1));
        assert!(model.here());
        // Started again while here: nothing more is loaded.
        model.start();
        assert_eq!((model.get(Duration::ZERO).copied(), loads.load(Ordering::SeqCst)), (Ok(1), 1));
    }

    #[test]
    fn a_wait_that_runs_out_leaves_it_coming() {
        let (mut model, _, _) = fake(300, false);
        model.start();
        assert!(model.get(Duration::from_millis(20)).is_err());
        assert!(model.loading());
        assert_eq!(model.get(Duration::from_secs(3)).copied(), Ok(1));
    }

    #[test]
    fn a_model_not_started_is_loaded_when_needed() {
        let (mut model, loads, _) = fake(0, false);
        assert_eq!(model.get(Duration::from_secs(1)).copied(), Ok(1));
        assert_eq!(loads.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_failed_load_is_reported_once() {
        let (mut model, _, _) = fake(10, true);
        model.start();
        assert_eq!(model.get(Duration::from_secs(3)).err().as_deref(), Some("no such file"));
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
