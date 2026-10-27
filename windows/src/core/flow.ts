// Flow dictation's settings (src-tauri/src/settings.rs `FlowPref`) and the
// small rules for the lists the Settings page edits: what may be added, what a
// duplicate is, how many there can be. Pure, so the tests can run it as it is.

import { PROVIDERS, providerDef, visibleProviders, type ProviderDef } from "./providers";
import type { Settings } from "./state";

/** The keys that can be held to dictate: each a modifier on its own, so holding it does nothing in any app. */
export const FLOW_KEYS = ["RightCtrl", "RightAlt", "RightShift"] as const;
export type FlowKeyName = (typeof FLOW_KEYS)[number];

/** How a key is written in the interface: the same in every language. */
export const FLOW_KEY_LABELS: Record<FlowKeyName, string> = {
  RightCtrl: "Right Ctrl",
  RightAlt: "Right Alt",
  RightShift: "Right Shift",
};

/** How the words are written (src-tauri/src/flow/style.rs): as said, without fillers and with a full stop, or in full sentences. */
export const FLOW_STYLES = ["verbatim", "clean", "sentences"] as const;
export type FlowStyle = (typeof FLOW_STYLES)[number];

export interface FlowPref {
  enabled: boolean;
  key: string;
  /** What is said, what is written instead. */
  replacements: [string, string][];
  dictionary: string[];
  /** A phrase to say, the text it stands for. */
  snippets: [string, string][];
  /** The user's own style for a program (its executable without ".exe"), over the built-in ones. */
  styles: [string, string][];
  /** Keep the text of each dictation to read again. Off: only the numbers of each day (flow/store.rs). */
  keepHistory: boolean;
  /** A model tidies the words before they are pasted (flow/cleanup.rs). Off by default: the text then goes to the provider. */
  cleanup: boolean;
  /** Paste in this language whatever was said: a name or a code. Empty: off. */
  translateTo: string;
  /** A chat provider's id, or empty for the chat's own. */
  cleanupProvider: string;
}

export const DEFAULT_FLOW: FlowPref = {
  enabled: false,
  key: "RightCtrl",
  replacements: [],
  dictionary: [],
  snippets: [],
  styles: [],
  keepHistory: true,
  cleanup: false,
  translateTo: "",
  cleanupProvider: "",
};

/** The longest a language name may be (Rust cuts it the same). */
export const MAX_LANGUAGE = 40;

/** Languages suggested for "Translate into": any name or code may be typed. */
export const FLOW_LANGUAGES = [
  "English", "French", "Spanish", "German", "Italian", "Portuguese", "Dutch", "Russian", "Polish", "Turkish",
  "Arabic", "Hindi", "Bengali", "Indonesian", "Japanese", "Korean", "Chinese (Simplified)", "Chinese (Traditional)",
] as const;

/** The providers clean-up can ask: the chat's, except Claude Code (no key, not a one-shot call). */
export function cleanupProviders(settings: Settings): ProviderDef[] {
  return visibleProviders(settings).filter((p) => p.id !== "claudecode");
}

/** Where the text goes: the provider chosen for clean-up, else the chat's. */
export function cleanupTarget(flow: Pick<FlowPref, "cleanupProvider">, chatProvider: string): ProviderDef {
  const id = flow.cleanupProvider.trim() || chatProvider;
  return PROVIDERS.find((p) => p.id === id) ?? providerDef("anthropic");
}

/** True when clean-up or translation is on, so text leaves for a provider. */
export function sendsText(flow: Pick<FlowPref, "cleanup" | "translateTo">): boolean {
  return flow.cleanup || flow.translateTo.trim() !== "";
}

/** Entries a list may hold: a dictionary is not a database. */
export const MAX_ENTRIES = 200;
/** The longest a phrase or a word may be. */
export const MAX_LENGTH = 200;
/** The longest a snippet's text may be: an address, a signature, a paragraph. */
export const MAX_SNIPPET = 2000;

/** A key name as one of ours; a name this build does not know reads as right Ctrl, as Rust does. */
export function flowKeyName(key: unknown): FlowKeyName {
  return FLOW_KEYS.find((k) => k === key) ?? "RightCtrl";
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * `list` with a replacement added: both sides need text; one that says the
 * same thing as an existing entry's "you say" replaces it. Null when it
 * cannot be added (an empty side, too long, too many).
 */
export function addReplacement(list: [string, string][], from: string, to: string): [string, string][] | null {
  const f = from.trim();
  const t = to.trim();
  if (!f || !t || f.length > MAX_LENGTH || t.length > MAX_LENGTH) return null;
  const at = list.findIndex(([existing]) => same(existing, f));
  if (at >= 0) return list.map((entry, i): [string, string] => (i === at ? [f, t] : entry));
  if (list.length >= MAX_ENTRIES) return null;
  return [...list, [f, t]];
}

/** `list` with a snippet added: a phrase to say and its text, which may have line breaks. The same phrase again replaces the first. */
export function addSnippet(list: [string, string][], trigger: string, text: string): [string, string][] | null {
  const tr = trigger.trim();
  const tx = text.trim();
  if (!tr || !tx || tr.length > MAX_LENGTH || tx.length > MAX_SNIPPET) return null;
  const at = list.findIndex(([existing]) => same(existing, tr));
  if (at >= 0) return list.map((entry, i): [string, string] => (i === at ? [tr, tx] : entry));
  if (list.length >= MAX_ENTRIES) return null;
  return [...list, [tr, tx]];
}

/** What is typed in the one-line field as a line break ("\\n") becomes one. */
export function lineBreaks(typed: string): string {
  return typed.replace(/\\n/g, "\n");
}

/** A snippet's text on one line for the list: its line breaks shown as an arrow. */
export function showBreaks(text: string): string {
  return text.replace(/\r?\n/g, " \u21b5 ");
}

/** A program as the styles list keeps it: "Slack.exe" is "slack", as Rust reads it (flow/style.rs `app_key`). */
export function appKey(program: string): string {
  const lower = program.trim().toLowerCase();
  return (lower.endsWith(".exe") ? lower.slice(0, -4) : lower).trim();
}

/** A style name as one of ours; one this build does not know reads as clean, as Rust does. */
export function flowStyleName(style: unknown): FlowStyle {
  return FLOW_STYLES.find((s) => s === style) ?? "clean";
}

/** `list` with a program's style set, replacing the one it had; null for a program with no name, one that is too long, or too many. */
export function setStyle(list: [string, string][], program: string, style: string): [string, string][] | null {
  const app = appKey(program);
  if (!app || app.length > MAX_LENGTH || !FLOW_STYLES.some((s) => s === style)) return null;
  const at = list.findIndex(([existing]) => appKey(existing) === app);
  if (at >= 0) return list.map((entry, i): [string, string] => (i === at ? [app, style] : entry));
  if (list.length >= MAX_ENTRIES) return null;
  return [...list, [app, style]];
}

/** `list` with a word added; null when it is empty, too long, already there (whatever its case) or too many. */
export function addWord(list: string[], word: string): string[] | null {
  const w = word.trim();
  if (!w || w.length > MAX_LENGTH || list.length >= MAX_ENTRIES || list.some((x) => same(x, w))) return null;
  return [...list, w];
}

export function removeAt<T>(list: T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

/** What the pill window shows (src-tauri/src/flow/pill.rs `PillState`). */
export type FlowPillName = "hidden" | "listening" | "locked" | "working" | "cleaning" | "message";

export interface FlowPillState {
  state: FlowPillName;
  /** The dictation the level events are about. */
  id: number;
  /** For "message": a code the page puts in words (pill/dots.ts `messageText`). For "cleaning": "translate" when nothing else is asked. */
  message: string;
  detail: string;
}

/** Flow's settings from whatever a settings.json or a page gave, with the defaults for what is missing. */
export function normalizeFlow(raw: unknown): FlowPref {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof FlowPref, unknown>>;
  const text = (v: unknown): v is string => typeof v === "string";
  const pairs = (v: unknown): [string, string][] =>
    Array.isArray(v) ? v.filter((p): p is [string, string] => Array.isArray(p) && text(p[0]) && text(p[1])).map(([a, b]) => [a, b]) : [];
  return {
    enabled: r.enabled === true,
    key: text(r.key) ? r.key : DEFAULT_FLOW.key,
    replacements: pairs(r.replacements),
    dictionary: Array.isArray(r.dictionary) ? r.dictionary.filter(text) : [],
    snippets: pairs(r.snippets),
    styles: pairs(r.styles),
    keepHistory: r.keepHistory !== false,
    cleanup: r.cleanup === true,
    translateTo: text(r.translateTo) ? r.translateTo.trim().slice(0, MAX_LANGUAGE) : "",
    cleanupProvider: text(r.cleanupProvider) ? r.cleanupProvider.trim() : "",
  };
}

// ── History and statistics (src-tauri/src/flow/store.rs) ──────────────────────

/** One kept dictation. */
export interface FlowEntry {
  /** Milliseconds since 1970. */
  at: number;
  /** The program it was pasted in ("slack"), when known. */
  app: string | null;
  words: number;
  seconds: number;
  text: string;
}

export interface FlowDay {
  /** "2026-10-14". */
  date: string;
  dictations: number;
  words: number;
  seconds: number;
}

export interface FlowStats {
  today: FlowDay;
  /** The last 30 days, oldest first, today last. */
  days: FlowDay[];
  streak: number;
  wordsPerMinute: number;
}

/** The last `count` days of the list (it is oldest first). */
export function lastDays(days: FlowDay[], count: number): FlowDay[] {
  return days.slice(Math.max(0, days.length - count));
}

/**
 * How tall each day's bar is, in percent of the chart: the busiest day is
 * 100, a day with words is never thinner than 4 so it can be seen, an empty
 * day is 0.
 */
export function barHeights(days: FlowDay[]): number[] {
  const most = Math.max(0, ...days.map((d) => d.words));
  return days.map((d) => (d.words > 0 && most > 0 ? Math.max(4, Math.round((d.words / most) * 100)) : 0));
}
