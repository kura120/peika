// Flow dictation, the page side: its settings and the lists the Settings page
// edits (src/core/flow.ts), the pill's dots and words (src/pill/dots.ts), and
// that the pill window is wired in (entry, capability, commands). The key
// logic, the text step and the paste are tested in Rust (src-tauri/src/flow/).

import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installFakeDom } from "./fakedom.mjs";
import { calls, sent } from "./tauri.mjs";
import {
  DEFAULT_FLOW, FLOW_KEYS, FLOW_KEY_LABELS, FLOW_STYLES, MAX_ENTRIES, MAX_LENGTH, MAX_SNIPPET, addReplacement,
  addSnippet, addWord, appKey, flowKeyName, flowStyleName, lineBreaks, normalizeFlow, removeAt, setStyle, showBreaks,
} from "../src/core/flow.ts";
import { DEFAULT_SETTINGS } from "../src/core/state.ts";
import { Bridge } from "../src/core/bridge.ts";
import { DOTS, HISTORY, REST, atRest, glide, messageText, pushLevel, targets } from "../src/pill/dots.ts";
import { setLanguage } from "../src/i18n/i18n.ts";

installFakeDom();

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

beforeEach(() => {
  setLanguage("en");
  calls.length = 0;
});

// ── Settings ──────────────────────────────────────────────────────────────────

test("Flow is off by default, on right Ctrl, with nothing in its lists", () => {
  assert.deepEqual(DEFAULT_SETTINGS.flow, {
    enabled: false, key: "RightCtrl", replacements: [], dictionary: [], snippets: [], styles: [],
  });
  assert.equal(DEFAULT_FLOW.enabled, false);
});

test("the keys to hold are three modifiers, each written the same in every language", () => {
  assert.deepEqual([...FLOW_KEYS], ["RightCtrl", "RightAlt", "RightShift"]);
  assert.deepEqual(FLOW_KEY_LABELS, { RightCtrl: "Right Ctrl", RightAlt: "Right Alt", RightShift: "Right Shift" });
});

test("a key this build does not know reads as right Ctrl, as Rust does", () => {
  assert.equal(flowKeyName("RightAlt"), "RightAlt");
  assert.equal(flowKeyName("F13"), "RightCtrl");
  assert.equal(flowKeyName(undefined), "RightCtrl");
  assert.equal(flowKeyName(3), "RightCtrl");
});

test("Flow's settings are read from whatever was saved, with defaults for the rest", () => {
  assert.deepEqual(normalizeFlow(undefined), DEFAULT_FLOW);
  assert.deepEqual(normalizeFlow("on"), DEFAULT_FLOW);
  assert.deepEqual(normalizeFlow({ enabled: true }), { ...DEFAULT_FLOW, enabled: true });
  assert.deepEqual(normalizeFlow({ enabled: 1, key: 5, replacements: "x", dictionary: {}, snippets: 3, styles: null }), DEFAULT_FLOW);
  assert.deepEqual(
    normalizeFlow({ replacements: [["a", "b"], ["c"], [1, 2], "d"], dictionary: ["Supabase", 4, null] }),
    { ...DEFAULT_FLOW, replacements: [["a", "b"]], dictionary: ["Supabase"] },
  );
});

test("snippets and styles are read as pairs, and what is not a pair is dropped", () => {
  assert.deepEqual(
    normalizeFlow({ snippets: [["my address", "12 Rue"], ["x"], [1, 2], "y"], styles: [["slack", "sentences"], ["cmd"], 7] }),
    { ...DEFAULT_FLOW, snippets: [["my address", "12 Rue"]], styles: [["slack", "sentences"]] },
  );
  // A style this build does not know is kept as it came: Rust reads it as clean.
  assert.deepEqual(normalizeFlow({ styles: [["slack", "poetic"]] }).styles, [["slack", "poetic"]]);
});

// ── The lists ─────────────────────────────────────────────────────────────────

test("a replacement needs text on both sides, and is kept as typed but trimmed", () => {
  assert.deepEqual(addReplacement([], "  cloud code ", " Claude Code "), [["cloud code", "Claude Code"]]);
  assert.equal(addReplacement([], "", "x"), null);
  assert.equal(addReplacement([], "x", "   "), null);
  assert.equal(addReplacement([], "x".repeat(MAX_LENGTH + 1), "y"), null);
});

test("saying the same thing twice replaces the first replacement, whatever the case", () => {
  const list = [["cloud code", "Claude Code"], ["pay ka", "Peika"]];
  assert.deepEqual(addReplacement(list, "Cloud Code", "Claude Code CLI"), [
    ["Cloud Code", "Claude Code CLI"],
    ["pay ka", "Peika"],
  ]);
  assert.deepEqual(list[0], ["cloud code", "Claude Code"], "the list given is not changed");
});

test("a dictionary word is trimmed, and not added twice", () => {
  assert.deepEqual(addWord([], "  Supabase "), ["Supabase"]);
  assert.equal(addWord(["Supabase"], "supabase"), null);
  assert.equal(addWord([], "   "), null);
  assert.equal(addWord([], "w".repeat(MAX_LENGTH + 1)), null);
});

test("a list holds only so many entries", () => {
  const words = Array.from({ length: MAX_ENTRIES }, (_, i) => `word${i}`);
  assert.equal(addWord(words, "one more"), null);
  const pairs = words.map((w) => [w, w.toUpperCase()]);
  assert.equal(addReplacement(pairs, "one", "more"), null);
  // Changing one that is there is still allowed.
  assert.equal(addReplacement(pairs, "WORD3", "changed").length, MAX_ENTRIES);
});

test("a snippet needs a phrase and a text, trimmed, and keeps its line breaks", () => {
  assert.deepEqual(addSnippet([], " my address ", "\n12 Rue Pasteur,\n75011 Paris \n"), [["my address", "12 Rue Pasteur,\n75011 Paris"]]);
  assert.equal(addSnippet([], "", "text"), null);
  assert.equal(addSnippet([], "phrase", "  \n "), null);
  assert.equal(addSnippet([], "p".repeat(MAX_LENGTH + 1), "text"), null);
  assert.equal(addSnippet([], "phrase", "t".repeat(MAX_SNIPPET + 1)), null);
  assert.equal(addSnippet([], "phrase", "t".repeat(MAX_SNIPPET)).length, 1, "a long text is still allowed up to the limit");
});

test("the same phrase twice replaces the first snippet, and a list holds only so many", () => {
  const list = [["my address", "old"], ["my iban", "FR76"]];
  assert.deepEqual(addSnippet(list, "My Address", "new"), [["My Address", "new"], ["my iban", "FR76"]]);
  assert.deepEqual(list[0], ["my address", "old"], "the list given is not changed");
  const full = Array.from({ length: MAX_ENTRIES }, (_, i) => [`phrase ${i}`, "text"]);
  assert.equal(addSnippet(full, "one more", "text"), null);
  assert.equal(addSnippet(full, "PHRASE 3", "changed").length, MAX_ENTRIES);
});

test("a line break is typed as backslash n in the one-line field, and shown as an arrow in the list", () => {
  assert.equal(lineBreaks("12 Rue Pasteur,\\n75011 Paris"), "12 Rue Pasteur,\n75011 Paris");
  assert.equal(lineBreaks("no break, C:\\temp"), "no break, C:\\temp");
  assert.equal(showBreaks("12 Rue Pasteur,\n75011 Paris"), "12 Rue Pasteur, \u21b5 75011 Paris");
  assert.equal(showBreaks("one line"), "one line");
});

// ── Styles ────────────────────────────────────────────────────────────────────

test("there are three styles, and one this build does not know reads as clean, as Rust does", () => {
  assert.deepEqual([...FLOW_STYLES], ["verbatim", "clean", "sentences"]);
  assert.equal(flowStyleName("sentences"), "sentences");
  assert.equal(flowStyleName("poetic"), "clean");
  assert.equal(flowStyleName(undefined), "clean");
});

test("a program is its executable in lower case without .exe, as Rust keys it", () => {
  assert.equal(appKey("Slack.exe"), "slack");
  assert.equal(appKey("  WindowsTerminal "), "windowsterminal");
  assert.equal(appKey("Code - Insiders"), "code - insiders");
  assert.equal(appKey(".exe"), "");
});

test("a program's style is set once: the second choice replaces the first", () => {
  const first = setStyle([], "Slack.exe", "sentences");
  assert.deepEqual(first, [["slack", "sentences"]]);
  assert.deepEqual(setStyle(first, "SLACK", "verbatim"), [["slack", "verbatim"]]);
  assert.deepEqual(setStyle(first, "code", "clean"), [["slack", "sentences"], ["code", "clean"]]);
  assert.deepEqual(first, [["slack", "sentences"]], "the list given is not changed");
});

test("a style needs a program with a name and one of the three styles", () => {
  assert.equal(setStyle([], "  ", "clean"), null);
  assert.equal(setStyle([], ".exe", "clean"), null);
  assert.equal(setStyle([], "slack", "poetic"), null);
  assert.equal(setStyle([], "a".repeat(MAX_LENGTH + 1), "clean"), null);
  const full = Array.from({ length: MAX_ENTRIES }, (_, i) => [`app${i}`, "clean"]);
  assert.equal(setStyle(full, "one more", "clean"), null);
  assert.equal(setStyle(full, "app3", "verbatim").length, MAX_ENTRIES);
});

test("removing an entry leaves the others in order", () => {
  assert.deepEqual(removeAt(["a", "b", "c"], 1), ["a", "c"]);
  assert.deepEqual(removeAt(["a"], 5), ["a"]);
});

// ── The pill's dots ───────────────────────────────────────────────────────────

test("levels go in front, newest first, and are kept to what the dots show", () => {
  let h = [];
  for (const v of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]) h = pushLevel(h, v);
  assert.equal(h.length, HISTORY);
  assert.deepEqual(h.slice(0, 2), [0.7, 0.6]);
  assert.deepEqual(pushLevel([], 4), [1], "a level is a fraction");
  assert.deepEqual(pushLevel([], -1), [0]);
  assert.deepEqual(pushLevel([], Number.NaN), [0]);
});

test("the newest level is the middle dot and older ones fall away to both sides", () => {
  const dots = targets([1, 0.5, 0.25, 0, 0]);
  assert.equal(dots.length, DOTS);
  const middle = Math.floor(DOTS / 2);
  assert.equal(dots[middle], 1);
  assert.equal(dots[middle - 1], dots[middle + 1]);
  assert.ok(dots[middle - 1] < dots[middle] && dots[middle - 2] < dots[middle - 1]);
  assert.equal(dots[0], REST);
  assert.deepEqual(targets([]), Array(DOTS).fill(REST));
});

test("the dots rise quickly, fall slowly, and come to rest", () => {
  const rest = Array(DOTS).fill(REST);
  const loud = Array(DOTS).fill(1);
  const up = glide(rest, loud, 0.033)[0];
  const down = glide(loud, rest, 0.033)[0];
  assert.ok(up - REST > 1 - down, "it rises further in a frame than it falls");
  let shown = rest;
  for (let i = 0; i < 200; i++) shown = glide(shown, loud, 0.033);
  assert.ok(atRest(shown, loud));
  assert.ok(!atRest(rest, loud));
});

// ── The pill's words ──────────────────────────────────────────────────────────

test("every message code has its own words, and an unknown one says why Flow stopped", () => {
  const codes = ["empty", "noengine", "busy", "elevated", "away", "copied"];
  const texts = codes.map((c) => messageText(c, ""));
  assert.equal(new Set(texts).size, codes.length);
  for (const text of texts) assert.ok(text.length > 5);
  assert.equal(messageText("failed", "No microphone"), "Flow stopped: No microphone");
  assert.equal(messageText("failed", ""), "Flow stopped.");
  // The ones that leave the words on the clipboard say how to paste them.
  for (const c of ["elevated", "away", "copied"]) assert.match(messageText(c, ""), /Ctrl\+V/);
});

test("the messages are put in words in another language", () => {
  setLanguage("fr");
  assert.notEqual(messageText("empty", ""), "Nothing was heard.");
  assert.notEqual(messageText("elevated", ""), messageText("away", ""));
});

// ── The commands ──────────────────────────────────────────────────────────────

test("the pill's ✕ and ✓ and its state are Bridge commands", async () => {
  await Bridge.flowPillCancel();
  await Bridge.flowPillFinish();
  await Bridge.flowPillState();
  assert.deepEqual(calls.map(([name]) => name), ["flow_pill_cancel", "flow_pill_finish", "flow_pill_state"]);
  assert.equal(sent("flow_pill_finish").length, 1);
});

// ── The window is wired in ────────────────────────────────────────────────────

test("the pill page is built, may call Peika's commands, and is a window the capability names", () => {
  assert.match(read("vite.config.ts"), /pill: resolve\(__dirname, "pill\.html"\)/);
  assert.match(read("pill.html"), /src\/pill\/main\.ts/);
  const capability = JSON.parse(read("src-tauri/capabilities/default.json"));
  assert.ok(capability.windows.includes("pill"));
  const lib = read("src-tauri/src/lib.rs");
  for (const command of ["flow_pill_state", "flow_pill_finish", "flow_pill_cancel"]) {
    assert.ok(lib.includes(`flow::${command}`), command);
  }
});
