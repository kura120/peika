// What Peika does to the words before pasting them, in this order:
//   1. snippets: a trigger phrase ("my address") becomes a mark, so that nothing
//      below rewrites inside the text it stands for;
//   2. the app's style (style.rs): fillers, capital, full stop;
//   3. the user's replacements ("cloud code" -> "Claude Code") and dictionary
//      (a word spelled the way the user spells it), outside the marks;
//   4. the marks become the snippets' texts.
// Ported from upstream's flow/text.rs (FlowText.swift); nothing here touches
// the OS, so it runs in the tests as it is.
//
// Clean-up by a model is not here: it comes around this step, not in it.

use super::style::{self, Style, MARK_CLOSE, MARK_OPEN};

/// A dictation with its snippets set aside: each trigger heard became a mark
/// (`⟦peikasnippet0⟧`), which carries letters and a number so that a replacement
/// phrase can neither match inside it nor across it.
#[derive(Debug, Clone, PartialEq)]
pub struct Marked {
    pub text: String,
    /// Mark -> the snippet's text.
    pub snippets: Vec<(String, String)>,
}

fn mark(index: usize) -> String {
    format!("{MARK_OPEN}peikasnippet{index}{MARK_CLOSE}")
}

/// Every snippet's trigger in `text` replaced by its mark. The triggers with
/// the most words go first, so that "my work address" is not eaten by "my
/// address". A snippet with no trigger or no text is skipped.
pub fn mark_snippets(text: &str, snippets: &[(String, String)]) -> Marked {
    let mut order: Vec<usize> = (0..snippets.len())
        .filter(|i| !snippets[*i].1.is_empty() && !tokens(&snippets[*i].0).is_empty())
        .collect();
    order.sort_by_key(|i| std::cmp::Reverse(tokens(&snippets[*i].0).len()));
    let mut out = text.to_string();
    let mut found = Vec::new();
    for i in order {
        let replaced = replacing(&snippets[i].0, &mark(i), &out);
        if replaced != out {
            found.push((mark(i), snippets[i].1.clone()));
            out = replaced;
        }
    }
    // Said alone, a snippet is the whole text: the engine's full stop after the
    // trigger is not part of it.
    if let [(only, _)] = found.as_slice() {
        if out.trim().trim_end_matches(['.', '!', '?', ',', '…']) == only.as_str() {
            out = only.clone();
        }
    }
    Marked { text: out, snippets: found }
}

/// The marks replaced by their snippets' text, in one pass: what a snippet
/// says is never looked at again, even if it looks like a mark.
pub fn expand(text: &str, snippets: &[(String, String)]) -> String {
    if snippets.is_empty() {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(MARK_OPEN) {
        out.push_str(&rest[..at]);
        let from = &rest[at..];
        // An opening with no end is only text.
        let Some(close) = from.find(MARK_CLOSE) else {
            rest = from;
            break;
        };
        let whole = &from[..close + MARK_CLOSE.len_utf8()];
        match snippets.iter().find(|(m, _)| m == whole) {
            Some((_, text)) => out.push_str(text),
            None => out.push_str(whole),
        }
        rest = &from[whole.len()..];
    }
    out.push_str(rest);
    out
}

/// Replacements first, then the dictionary's words get their exact spelling.
pub fn fix_words(text: &str, words: &[String], replacements: &[(String, String)]) -> String {
    let mut out = text.trim().to_string();
    for (from, to) in replacements {
        // A replacement with nothing to put would only delete the word.
        if !to.is_empty() {
            out = replacing(from, to, &out);
        }
    }
    for word in words {
        if is_plain_word(word) {
            out = replacing(word, word, &out);
        }
    }
    out
}

/// Everything done on this computer, in the order above.
pub fn apply(
    text: &str,
    words: &[String],
    replacements: &[(String, String)],
    snippets: &[(String, String)],
    style: Style,
) -> String {
    let marked = mark_snippets(text.trim(), snippets);
    let styled = style::tidy(&marked.text, style);
    expand(&fix_words(&styled, words, replacements), &marked.snippets)
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric()
}

/// The letters-and-digits runs of a phrase: "Rendez-vous !" → ["Rendez", "vous"].
pub fn tokens(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    for c in s.chars() {
        if is_word_char(c) {
            current.push(c);
        } else if !current.is_empty() {
            out.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

/// A run of word characters in a text, by char index.
struct Run {
    start: usize,
    end: usize,
    lower: String,
}

fn runs(chars: &[char]) -> Vec<Run> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if is_word_char(chars[i]) {
            let start = i;
            while i < chars.len() && is_word_char(chars[i]) {
                i += 1;
            }
            let lower: String = chars[start..i].iter().collect::<String>().to_lowercase();
            out.push(Run { start, end: i, lower });
        } else {
            i += 1;
        }
    }
    out
}

/// Every occurrence of `phrase`, ignoring case and what separates its words
/// ("rendez vous", "Rendez-vous"), but only as whole words: "art" never matches
/// in "partir".
pub fn replacing(phrase: &str, replacement: &str, text: &str) -> String {
    let wanted: Vec<String> = tokens(phrase).into_iter().map(|t| t.to_lowercase()).collect();
    if wanted.is_empty() {
        return text.to_string();
    }
    let chars: Vec<char> = text.chars().collect();
    let runs = runs(&chars);
    let mut out = String::with_capacity(text.len());
    let mut copied = 0; // char index copied up to
    let mut i = 0;
    while i + wanted.len() <= runs.len() {
        let matches = wanted.iter().enumerate().all(|(k, w)| runs[i + k].lower == *w);
        if matches {
            let start = runs[i].start;
            let end = runs[i + wanted.len() - 1].end;
            out.extend(&chars[copied..start]);
            out.push_str(replacement);
            copied = end;
            i += wanted.len();
        } else {
            i += 1;
        }
    }
    out.extend(&chars[copied..]);
    out
}

/// Only words made of letters, digits, spaces, hyphens and apostrophes get
/// their spelling fixed: "C++" would match every lone "c".
pub fn is_plain_word(word: &str) -> bool {
    let letters = word.chars().filter(|c| c.is_alphanumeric()).count();
    letters >= 2 && word.chars().all(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '\'' | '’'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rep(from: &str, to: &str) -> (String, String) {
        (from.to_string(), to.to_string())
    }

    #[test]
    fn replacements_ignore_case_and_separators_but_keep_whole_words() {
        assert_eq!(replacing("cloud code", "Claude Code", "j'ouvre Cloud-Code ce matin"), "j'ouvre Claude Code ce matin");
        assert_eq!(replacing("rendez vous", "rendez-vous", "un Rendez vous demain"), "un rendez-vous demain");
        assert_eq!(replacing("art", "ART", "partir à l'art"), "partir à l'ART");
        assert_eq!(replacing("", "x", "rien"), "rien");
        assert_eq!(replacing("open ai", "x", "I use OpenAI and open-ai"), "I use OpenAI and x");
    }

    #[test]
    fn the_dictionary_fixes_the_spelling_of_plain_words_only() {
        let words = vec!["Supabase".to_string(), "C++".to_string(), "Next.js".to_string()];
        assert_eq!(fix_words("on passe sur supabase et c", &words, &[]), "on passe sur Supabase et c");
        assert!(is_plain_word("Claude Code"));
        assert!(is_plain_word("aujourd'hui"));
        assert!(!is_plain_word("C++"));
        assert!(!is_plain_word("x"));
    }

    #[test]
    fn replacements_come_before_the_dictionary() {
        let words = vec!["Peika".to_string()];
        let reps = vec![rep("pay ka", "peika")];
        assert_eq!(fix_words("ask pay ka now", &words, &reps), "ask Peika now");
    }

    #[test]
    fn a_replacement_runs_over_what_the_one_before_wrote() {
        let reps = vec![rep("cloud code", "Claude Code"), rep("claude code", "Claude Code CLI")];
        assert_eq!(fix_words("open cloud code", &[], &reps), "open Claude Code CLI");
    }

    #[test]
    fn a_replacement_with_nothing_to_put_is_left_alone() {
        let reps = vec![rep("um", ""), rep("", "x")];
        assert_eq!(fix_words("um hello", &[], &reps), "um hello");
    }

    #[test]
    fn the_words_are_trimmed_and_nothing_gives_nothing() {
        assert_eq!(fix_words("  hello world \n", &[], &[]), "hello world");
        assert_eq!(fix_words("   ", &["Peika".to_string()], &[rep("a", "b")]), "");
        assert_eq!(fix_words("", &[], &[]), "");
    }

    #[test]
    fn the_replacement_is_put_in_as_written() {
        // Dollar signs and braces mean nothing here.
        assert_eq!(fix_words("price tag", &[], &[rep("price tag", "${1} {name}")]), "${1} {name}");
        assert_eq!(fix_words("multi", &[], &[rep("multi", "one\ntwo")]), "one\ntwo");
    }

    #[test]
    fn tokens_are_the_runs_of_letters_and_digits() {
        assert_eq!(tokens("Rendez-vous !"), vec!["Rendez", "vous"]);
        assert!(tokens(" ?! ").is_empty());
    }

    // ── Snippets and styles ───────────────────────────────────────────────────

    fn pair(a: &str, b: &str) -> (String, String) {
        (a.to_string(), b.to_string())
    }

    fn all(text: &str, words: &[&str], reps: &[(&str, &str)], snippets: &[(&str, &str)], style: Style) -> String {
        let words: Vec<String> = words.iter().map(|w| w.to_string()).collect();
        let reps: Vec<_> = reps.iter().map(|(a, b)| pair(a, b)).collect();
        let snippets: Vec<_> = snippets.iter().map(|(a, b)| pair(a, b)).collect();
        apply(text, &words, &reps, &snippets, style)
    }

    #[test]
    fn a_snippet_said_alone_or_inside_the_dictation_becomes_its_text() {
        let snippets = [("my address", "12 Rue Pasteur,\n75011 Paris")];
        assert_eq!(all("My address.", &[], &[], &snippets, Style::Clean), "12 Rue Pasteur,\n75011 Paris");
        assert_eq!(all("send it to my address please", &[], &[], &snippets, Style::Verbatim), "send it to 12 Rue Pasteur,\n75011 Paris please");
        assert_eq!(all("send it to my-address", &[], &[], &snippets, Style::Verbatim), "send it to 12 Rue Pasteur,\n75011 Paris");
        assert_eq!(all("nothing to expand", &[], &[], &snippets, Style::Verbatim), "nothing to expand");
    }

    #[test]
    fn nothing_rewrites_inside_a_snippet() {
        let snippets = [("my signature", "Best regards, um, Louis Code")];
        let reps = [("code", "CODE"), ("best", "worst")];
        // Not the replacements, not the dictionary, not the style's fillers or full stop.
        assert_eq!(
            all("thanks code my signature", &["Louis"], &reps, &snippets, Style::Sentences),
            "Thanks CODE Best regards, um, Louis Code"
        );
        assert_eq!(all("my signature", &["signature"], &[("my", "your")], &snippets, Style::Clean), "Best regards, um, Louis Code");
    }

    #[test]
    fn a_replacement_cannot_reach_across_a_snippet() {
        let snippets = [("the middle", "(X)")];
        let reps = [("start end", "BOTH")];
        assert_eq!(all("start the middle end", &[], &reps, &snippets, Style::Verbatim), "start (X) end");
        // Nor can a number in a replacement hit the mark's own.
        assert_eq!(all("the middle", &[], &[("0", "zero"), ("1", "one")], &snippets, Style::Verbatim), "(X)");
    }

    #[test]
    fn the_longer_trigger_wins_and_the_marks_follow_the_list() {
        let snippets = [("my address", "HOME"), ("my work address", "WORK"), ("my work", "JOB")];
        assert_eq!(all("write to my work address", &[], &[], &snippets, Style::Verbatim), "write to WORK");
        assert_eq!(all("my address and my work", &[], &[], &snippets, Style::Verbatim), "HOME and JOB");
        let marked = mark_snippets("my address and my work", &snippets.map(|(a, b)| pair(a, b)));
        assert_eq!(marked.snippets.len(), 2);
        assert!(marked.snippets.iter().any(|(m, t)| m == "⟦peikasnippet0⟧" && t == "HOME"));
        assert!(marked.snippets.iter().any(|(m, t)| m == "⟦peikasnippet2⟧" && t == "JOB"));
    }

    #[test]
    fn a_snippet_with_no_trigger_or_no_text_is_never_a_mark() {
        let snippets = [("", "x"), ("  ?! ", "y"), ("empty", "")];
        assert_eq!(all("so empty", &[], &[], &snippets, Style::Verbatim), "so empty");
    }

    #[test]
    fn a_snippet_s_text_that_looks_like_a_mark_is_left_as_written() {
        let snippets = [("one", "⟦peikasnippet1⟧"), ("two", "SECOND")];
        assert_eq!(all("one two", &[], &[], &snippets, Style::Verbatim), "⟦peikasnippet1⟧ SECOND");
        // A mark the text brings that no snippet owns stays as it came.
        assert_eq!(expand("a ⟦peikasnippet9⟧ b ⟦ open", &[pair("⟦peikasnippet0⟧", "X")]), "a ⟦peikasnippet9⟧ b ⟦ open");
    }

    #[test]
    fn the_style_comes_before_the_words_and_the_words_have_the_last_say() {
        let reps = [("cloud code", "claude code")];
        // The capital is the style's, then the user's spelling is put in as written.
        assert_eq!(all("cloud code is open", &[], &reps, &[], Style::Clean), "claude code is open.");
        assert_eq!(all("um open cloud code", &["Claude Code"], &reps, &[], Style::Clean), "Open Claude Code.");
        assert_eq!(all("um cloud code", &[], &reps, &[], Style::Verbatim), "um claude code");
    }

    #[test]
    fn nothing_said_gives_nothing_in_every_style() {
        for style in [Style::Verbatim, Style::Clean, Style::Sentences] {
            assert_eq!(all("   ", &["Peika"], &[("a", "b")], &[("x", "y")], style), "");
        }
        // Only a filler: gone when the style trims fillers, as said otherwise.
        assert_eq!(all("  um  ", &[], &[], &[], Style::Clean), "");
        assert_eq!(all("  um  ", &[], &[], &[], Style::Sentences), "");
        assert_eq!(all("  um  ", &[], &[], &[], Style::Verbatim), "um");
    }
}
