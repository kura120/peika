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
  DEFAULT_FLOW, FLOW_KEYS, FLOW_KEY_LABELS, MAX_ENTRIES, MAX_LENGTH, addReplacement, addWord, flowKeyName,
  FLOW_LANGUAGES, MAX_LANGUAGE, cleanupProviders, cleanupTarget, normalizeFlow, removeAt, sendsText,
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
    enabled: false, key: "RightCtrl", replacements: [], dictionary: [], cleanup: false, translateTo: "", cleanupProvider: "",
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
  assert.deepEqual(normalizeFlow({ enabled: 1, key: 5, replacements: "x", dictionary: {} }), DEFAULT_FLOW);
  assert.deepEqual(
    normalizeFlow({ replacements: [["a", "b"], ["c"], [1, 2], "d"], dictionary: ["Supabase", 4, null] }),
    { ...DEFAULT_FLOW, replacements: [["a", "b"]], dictionary: ["Supabase"] },
  );
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
