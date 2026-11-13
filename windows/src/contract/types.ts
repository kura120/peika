// What a theme is told: read-only data, nothing more. Every field is
// `readonly` so that a theme cannot write to what it is shown, and nothing
// here carries content read from another app (a control's name, a window's
// title, a field's text): that is never stored or passed on.

/** One agent session, as one row of the island. */
export interface SessionRow {
  readonly id: string;
  /** The folder or task name. */
  readonly title: string;
  readonly agent: { readonly id: string; readonly name: string; /** A hex string such as "#14B8A6". */ readonly color: string };
  readonly state: "working" | "needs-you" | "done" | "failed" | "idle";
  /** One line: what it is doing now. */
  readonly detail?: string;
}

/**
 * A request that waits for the user's answer. A theme is told only that it
 * exists and this one line. Its full text, and the buttons that answer it,
 * belong to Peika's own window, never to a theme.
 */
export interface RequestInfo {
  readonly id: string;
  readonly sessionId: string;
  /** The agent's name. */
  readonly from: string;
  /** One line, for example "Codex wants to run a command". */
  readonly summary: string;
}

/** What waits for the user, and the things Peika was asked to watch. */
export interface WaitingItem {
  readonly id: string;
  readonly kind: "finished" | "failed" | "needs-you" | "watch";
  readonly text: string;
  readonly detail?: string;
  readonly attention: boolean;
}

/** The short reply to words the user sent. */
export interface AnswerInfo {
  readonly id: string;
  readonly question: string;
  readonly text: string;
}

export interface ModelRow {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  /** What it is used for. */
  readonly job: string;
}

export type PermissionGroup = "see-screen" | "type-and-click" | "read-memory" | "your-folders";
export type PermissionLevel = "allow" | "ask" | "never";

export interface PermissionRow {
  readonly modelId: string;
  readonly group: PermissionGroup;
  readonly level: PermissionLevel;
}

export interface DriverRow {
  readonly id: string;
  readonly name: string;
  readonly kind: "service" | "model" | "agent";
  readonly origin: "built-in" | "verified" | "added-by-you";
  readonly on: boolean;
  readonly state: "running" | "stopped" | "failed";
  /** What it needs, in plain sentences. */
  readonly needs: readonly string[];
  /** What it adds, in plain sentences. */
  readonly adds: readonly string[];
}

/** A mark drawn on the screen. It has a shape and nothing read from the app under it. */
export interface MarkRow {
  readonly id: string;
  readonly shape: "ring" | "arrow" | "underline" | "bracket" | "spotlight" | "pointer";
  readonly approximate: boolean;
}

/** One thing that was done, for the History page. */
export interface HistoryEntry {
  readonly id: string;
  /** Milliseconds since 1970. */
  readonly at: number;
  readonly who: { readonly kind: "model" | "driver" | "theme"; readonly id: string };
  /** The ability's name. */
  readonly what: string;
  /** A short phrase, never content. */
  readonly result: string;
  readonly undoable: boolean;
}

/** Everything a theme is told, at one moment. */
export interface Snapshot {
  readonly version: number;
  readonly sessions: readonly SessionRow[];
  readonly requests: readonly RequestInfo[];
  readonly waiting: readonly WaitingItem[];
  readonly answer: AnswerInfo | null;
  readonly models: readonly ModelRow[];
  readonly permissions: readonly PermissionRow[];
  readonly drivers: readonly DriverRow[];
  readonly marks: readonly MarkRow[];
  readonly history: readonly HistoryEntry[];
}
