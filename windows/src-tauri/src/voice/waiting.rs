// Sentences that ended while the bundled hearing model was not here yet.
//
// The listener must come back to the microphone at least every half second,
// because that is all Windows keeps of it (speech/capture.rs): it cannot stand
// and wait for a model that takes a second or two to load. A sentence that
// ends meanwhile is kept here instead, and written down, in order, once the
// model has arrived. It is kept in memory only, for a short time, and never
// logged.

#![cfg_attr(not(windows), allow(dead_code))]

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use super::session::Raw;

/// How many sentences may wait: more than that is not a command being said,
/// and the oldest goes.
pub const MOST: usize = 3;

/// What a waiting sentence is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// A sentence of its own.
    Sentence,
    /// What was said after the wake phrase, in the sentence that had it.
    Tail,
}

pub struct Waited {
    pub samples: Vec<f32>,
    pub since: Instant,
    pub kind: Kind,
}

pub struct Waiting {
    items: VecDeque<Waited>,
    /// How long one may wait before it is dropped.
    limit: Duration,
}

impl Waiting {
    pub fn new(limit: Duration) -> Self {
        Self { items: VecDeque::new(), limit }
    }

    /// Another sentence waits. What it pushed out, when the line was full
    /// (the oldest), is told so the listener can say it was not ready in time.
    pub fn push(&mut self, samples: Vec<f32>, kind: Kind, now: Instant) -> Vec<Kind> {
        let mut dropped = Vec::new();
        while self.items.len() >= MOST {
            if let Some(oldest) = self.items.pop_front() {
                dropped.push(oldest.kind);
            }
        }
        self.items.push_back(Waited { samples, since: now, kind });
        dropped
    }

    /// The ones that waited past the limit, dropped; told once.
    pub fn expire(&mut self, now: Instant) -> Vec<Kind> {
        let mut dropped = Vec::new();
        // They wait in the order they came: the oldest is the first to run out.
        while self.items.front().is_some_and(|w| now.saturating_duration_since(w.since) >= self.limit) {
            if let Some(w) = self.items.pop_front() {
                dropped.push(w.kind);
            }
        }
        dropped
    }

    /// The one that has waited longest.
    pub fn pop(&mut self) -> Option<Waited> {
        self.items.pop_front()
    }

    /// One taken to be written down that cannot be yet: first in line again.
    pub fn put_back(&mut self, waited: Waited) {
        self.items.push_front(waited);
    }

    /// The model will not come: nothing waits for it.
    pub fn clear(&mut self) {
        self.items.clear();
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

/// What a sentence that has been written down comes to. The tail of the wake
/// phrase's sentence that is not words was only the end of "peika": no
/// command was missed. A sentence of its own that is not words was one.
pub fn settle(kind: Kind, written: Raw) -> Option<Raw> {
    match (kind, written) {
        (Kind::Tail, Raw::Rejected) => None,
        (_, raw) => Some(raw),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voice::session::Rule;

    fn sentence(n: f32) -> Vec<f32> {
        vec![n]
    }

    #[test]
    fn sentences_come_out_in_the_order_they_were_queued() {
        let now = Instant::now();
        let mut line = Waiting::new(Duration::from_secs(15));
        assert!(line.push(sentence(1.0), Kind::Sentence, now).is_empty());
        assert!(line.push(sentence(2.0), Kind::Tail, now).is_empty());
        assert_eq!(line.pop().map(|w| (w.samples[0], w.kind)), Some((1.0, Kind::Sentence)));
        // One that could not be written yet is first in line again.
        let second = line.pop().unwrap();
        line.put_back(second);
        assert_eq!(line.pop().map(|w| (w.samples[0], w.kind)), Some((2.0, Kind::Tail)));
        assert!(line.pop().is_none() && line.is_empty());
    }

    #[test]
    fn one_that_waits_past_the_limit_is_dropped_and_told_once() {
        let start = Instant::now();
        let mut line = Waiting::new(Duration::from_secs(15));
        line.push(sentence(1.0), Kind::Sentence, start);
        line.push(sentence(2.0), Kind::Tail, start + Duration::from_secs(10));
        assert!(line.expire(start + Duration::from_secs(14)).is_empty());
        assert_eq!(line.expire(start + Duration::from_secs(16)), vec![Kind::Sentence]);
        // Told once: the second is not yet due, and the first is gone.
        assert!(line.expire(start + Duration::from_secs(16)).is_empty());
        assert_eq!(line.expire(start + Duration::from_secs(26)), vec![Kind::Tail]);
        assert!(line.is_empty());
    }

    #[test]
    fn a_full_line_drops_the_oldest() {
        let now = Instant::now();
        let mut line = Waiting::new(Duration::from_secs(15));
        for n in 0..MOST {
            assert!(line.push(sentence(n as f32), Kind::Sentence, now).is_empty());
        }
        assert_eq!(line.push(sentence(9.0), Kind::Sentence, now), vec![Kind::Sentence]);
        let order: Vec<f32> = std::iter::from_fn(|| line.pop()).map(|w| w.samples[0]).collect();
        assert_eq!(order, vec![1.0, 2.0, 9.0]);
    }

    #[test]
    fn a_tail_that_is_not_words_is_dropped_silently_and_a_sentence_is_a_miss() {
        assert_eq!(settle(Kind::Tail, Raw::Rejected), None);
        assert_eq!(settle(Kind::Sentence, Raw::Rejected), Some(Raw::Rejected));
        let words = Raw::Phrase { rule: Rule::Command, text: "next track".into(), confidence: 1.0 };
        assert_eq!(settle(Kind::Tail, words.clone()), Some(words.clone()));
        assert_eq!(settle(Kind::Sentence, words.clone()), Some(words));
    }

    #[test]
    fn a_failed_load_empties_the_line() {
        let now = Instant::now();
        let mut line = Waiting::new(Duration::from_secs(15));
        line.push(sentence(1.0), Kind::Sentence, now);
        line.push(sentence(2.0), Kind::Tail, now);
        line.clear();
        assert!(line.is_empty() && line.pop().is_none());
    }
}
