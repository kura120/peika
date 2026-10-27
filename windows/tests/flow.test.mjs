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
  DEFAULT_FLOW, FLOW_KEYS, FLOW_KEY_LABELS, FLOW_LANGUAGES, FLOW_STYLES, MAX_ENTRIES, MAX_LANGUAGE, MAX_LENGTH, MAX_SNIPPET,
  addReplacement, addSnippet, addWord, appKey, barHeights, cleanupProviders, cleanupTarget, flowKeyName, flowStyleName,
  lastDays, lineBreaks, normalizeFlow, removeAt, sendsText, setStyle, showBreaks,
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
    enabled: false, key: "RightCtrl", replacements: [], dictionary: [], snippets: [], styles: [], keepHistory: true,
    cleanup: false, translateTo: "", cleanupProvider: "",
  });
  assert.equal(DEFAULT_FLOW.enabled, false);
});

test("clean-up and translation are off by default and send nothing", () => {
  assert.equal(DEFAULT_FLOW.cleanup, false);
  assert.equal(DEFAULT_FLOW.translateTo, "");
  assert.equal(DEFAULT_FLOW.cleanupProvider, "");
  assert.equal(sendsText(DEFAULT_FLOW), false);
  assert.equal(sendsText({ cleanup: true, translateTo: "" }), true);
  assert.equal(sendsText({ cleanup: false, translateTo: " French " }), true);
  assert.equal(sendsText({ cleanup: false, translateTo: "   " }), false);
});

test("the clean-up settings are read as they were saved, the language cut to one short line", () => {
  assert.deepEqual(
    normalizeFlow({ cleanup: true, translateTo: "  French ", cleanupProvider: " ollama " }),
    { ...DEFAULT_FLOW, cleanup: true, translateTo: "French", cleanupProvider: "ollama" },
  );
  assert.deepEqual(normalizeFlow({ cleanup: "yes", translateTo: 4, cleanupProvider: null }), DEFAULT_FLOW);
  assert.equal(normalizeFlow({ translateTo: "x".repeat(100) }).translateTo.length, MAX_LANGUAGE);
  assert.ok(FLOW_LANGUAGES.includes("French"));
});

test("the text goes to the provider chosen for clean-up, else to the chat's, and never to Claude Code", () => {
  assert.equal(cleanupTarget({ cleanupProvider: "" }, "openai").id, "openai");
  assert.equal(cleanupTarget({ cleanupProvider: "google" }, "openai").id, "google");
  assert.equal(cleanupTarget({ cleanupProvider: "" }, "nowhere").id, "anthropic");
  const ids = cleanupProviders({ ...DEFAULT_SETTINGS, chatProvider: "claudecode" }).map((p) => p.id);
  assert.ok(ids.includes("anthropic") && ids.includes("openai"));
  assert.ok(!ids.includes("claudecode"));
  // A model server appears once it is connected.
  assert.ok(!ids.includes("ollama"));
  const connected = cleanupProviders({ ...DEFAULT_SETTINGS, ollamaUrl: "http://127.0.0.1:11434" }).map((p) => p.id);
  assert.ok(connected.includes("ollama"));
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

test("the history is kept unless it was switched off", () => {
  assert.equal(DEFAULT_FLOW.keepHistory, true);
  assert.equal(normalizeFlow({ keepHistory: false }).keepHistory, false);
  assert.equal(normalizeFlow({ keepHistory: 0 }).keepHistory, true);
  assert.equal(normalizeFlow({ keepHistory: "no" }).keepHistory, true);
});

// ── History and statistics ────────────────────────────────────────────────────

const day = (date, words) => ({ date, dictations: words > 0 ? 1 : 0, words, seconds: words });

test("the chart shows the last days, oldest first, with the busiest day full height", () => {
  const days = Array.from({ length: 30 }, (_, i) => day(`2026-09-${String(i + 1).padStart(2, "0")}`, i === 29 ? 200 : i === 28 ? 50 : 0));
  const last = lastDays(days, 14);
  assert.equal(last.length, 14);
  assert.equal(last[0].date, "2026-09-17");
  assert.equal(last[13].words, 200);
  const heights = barHeights(last);
  assert.deepEqual([heights[13], heights[12], heights[0]], [100, 25, 0]);
  assert.equal(lastDays(days.slice(0, 3), 14).length, 3);
});

test("a day with a few words still shows a bar, and an empty chart has none", () => {
  assert.deepEqual(barHeights([day("a", 1), day("b", 1000), day("c", 0)]), [4, 100, 0]);
  assert.deepEqual(barHeights([day("a", 0), day("b", 0)]), [0, 0]);
  assert.deepEqual(barHeights([]), []);
});

test("the history and the numbers are Bridge commands", async () => {
  await Bridge.flowHistory();
  await Bridge.flowStats();
  await Bridge.flowHistoryClear();
  assert.deepEqual(calls.map(([name]) => name), ["flow_history", "flow_stats", "flow_history_clear"]);
});

test("the Flow group of the settings tree has the History and Statistics pages, and their commands are registered", () => {
  const main = read("src/settings/main.ts");
  assert.match(main, /\["flow-history", N_\("History"\)\], \["flow-stats", N_\("Statistics"\)\]/);
  assert.match(main, /"flow-history": page\(/);
  assert.match(main, /"flow-stats": page\(/);
  const lib = read("src-tauri/src/lib.rs");
  for (const command of ["flow_history", "flow_stats", "flow_history_clear"]) {
    assert.ok(lib.includes(`flow::store::${command}`), command);
  }
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

test("a clean-up that could not run says why, in its own words", () => {
  const slow = messageText("asheard", "slow");
  const none = messageText("asheard", "unavailable");
  const other = messageText("asheard", "failed");
  assert.equal(new Set([slow, none, other]).size, 3);
  for (const text of [slow, none, other]) assert.match(text, /as heard/);
  assert.equal(messageText("asheard", ""), other);
});

test("the pill shows a waiting state while a model works, with words of its own", () => {
  const rust = read("src-tauri/src/flow/pill.rs");
  assert.match(rust, /state: "cleaning"/);
  const page = read("src/pill/main.ts");
  assert.match(page, /case "cleaning"/);
  assert.match(page, /Cleaning up…/);
  assert.match(page, /Translating…/);
  assert.match(read("src/pill/pill.css"), /data-state="cleaning"/);
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
