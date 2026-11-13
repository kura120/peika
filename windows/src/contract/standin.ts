// A stand-in for Peika that serves sample data, so a page can run in a plain
// browser while the real thing is built in Rust. It follows the same rules as
// the real one: snapshots cannot be written to, an ask always resolves, and a
// request is answered only by a click in Peika's own window (here, `controls`).

import type { Ask, AskResult } from "./asks";
import type { ThemeHost } from "./host";
import type { SessionRow, Snapshot } from "./types";
import { CONTRACT_VERSION } from "./version";

/** Only for development pages: it stands for what the user does outside the theme. */
export interface StandInControls {
  /** Stands for Peika's own window being clicked. It is not on `ThemeHost`. */
  resolveRequest(id: string): void;
  addSession(row: SessionRow): void;
  setSessionState(id: string, state: SessionRow["state"]): void;
}

export interface StandIn extends ThemeHost {
  readonly controls: StandInControls;
}

/** How long the sample reply takes, so a page can show its waiting state. */
const REPLY_DELAY_MS = 400;

const sample = (): Snapshot => ({
  version: CONTRACT_VERSION,
  sessions: [
    { id: "s-web", title: "web", agent: { id: "codex", name: "Codex", color: "#14B8A6" }, state: "needs-you", detail: "Wants to run a command" },
    { id: "s-peika", title: "peika", agent: { id: "claude-code", name: "Claude Code", color: "#D97757" }, state: "working", detail: "Editing a file" },
    { id: "s-api", title: "api", agent: { id: "gemini-cli", name: "Gemini CLI", color: "#4F8DF7" }, state: "done" },
  ],
  requests: [{ id: "r-1", sessionId: "s-web", from: "Codex", summary: "Codex wants to run a command" }],
  waiting: [
    { id: "w-1", kind: "finished", text: "api finished", attention: false },
    { id: "w-2", kind: "watch", text: "CI on #101", detail: "Until it's green or red", attention: false },
    { id: "w-3", kind: "watch", text: "1 review", attention: true },
  ],
  answer: null,
  models: [
    { id: "m-chat", name: "Sample chat model", color: "#8B5CF6", job: "Answers your words" },
    { id: "m-eyes", name: "Sample screen model", color: "#F59E0B", job: "Looks at the screen when you ask" },
  ],
  permissions: [
    { modelId: "m-chat", group: "see-screen", level: "ask" },
    { modelId: "m-chat", group: "your-folders", level: "never" },
    { modelId: "m-eyes", group: "see-screen", level: "allow" },
  ],
  drivers: [
    { id: "d-notes", name: "Notes", kind: "service", origin: "built-in", on: true, state: "running", needs: [], adds: ["Keeps short notes for you."] },
    { id: "d-voice", name: "Voice", kind: "model", origin: "verified", on: true, state: "stopped", needs: ["Uses the microphone."], adds: ["Lets you talk to Peika."] },
    { id: "d-helper", name: "My helper", kind: "agent", origin: "added-by-you", on: false, state: "stopped", needs: ["Reads your folders."], adds: ["Runs a helper you added."] },
  ],
  marks: [],
  history: [
    { id: "h-1", at: 1_700_000_000_000, who: { kind: "model", id: "m-chat" }, what: "open-session", result: "Opened a session", undoable: false },
    { id: "h-2", at: 1_700_000_060_000, who: { kind: "driver", id: "d-notes" }, what: "show", result: "Shown", undoable: true },
  ],
});

const deepFreeze = (value: unknown): void => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const inner of Object.values(value)) deepFreeze(inner);
  Object.freeze(value);
};

/** Freezes a snapshot all the way down, so a theme cannot write to anything it is shown. */
const freeze = (snapshot: Snapshot): Snapshot => {
  deepFreeze(snapshot);
  return snapshot;
};

export function createStandIn(): StandIn {
  let state: Snapshot = freeze(sample());
  const listeners = new Set<(change: Partial<Snapshot>) => void>();
  let replies = 0;

  /** Replaces the parts that changed with new frozen values, then tells every listener what changed. */
  const change = (part: Partial<Snapshot>): void => {
    state = freeze({ ...state, ...part });
    const told: Partial<Snapshot> = {};
    for (const key of Object.keys(part)) Object.assign(told, { [key]: state[key as keyof Snapshot] });
    for (const listener of [...listeners]) listener(told);
  };

  const hasSession = (id: string): boolean => state.sessions.some((row) => row.id === id);

  const ask = async (request: Ask): Promise<AskResult> => {
    switch (request.type) {
      case "send-words": {
        if (request.to.kind === "session" && !hasSession(request.to.id)) return { ok: false, reason: "Peika has no such session." };
        const question = request.text;
        setTimeout(() => change({ answer: { id: `a-${++replies}`, question, text: "Sample reply: this is what an answer looks like." } }), REPLY_DELAY_MS);
        return { ok: true };
      }
      case "open-session":
        return hasSession(request.id) ? { ok: true } : { ok: false, reason: "Peika has no such session." };
      case "set-permission":
      case "set-driver":
        // Either needs the user's own click in Peika's window, so nothing changes here.
        return { ok: true, waitingForClick: true };
      case "show":
      case "hide":
      case "resize":
      case "open-settings":
      case "clear-marks":
      case "undo":
      case "forget":
        return { ok: true };
      default:
        // A theme written in plain JavaScript may send what is not in the list.
        return { ok: false, reason: "Peika does not know that ask." };
    }
  };

  const controls: StandInControls = {
    resolveRequest(id) {
      if (!state.requests.some((row) => row.id === id)) return;
      change({ requests: state.requests.filter((row) => row.id !== id) });
    },
    addSession(row) {
      change({ sessions: [...state.sessions, structuredClone(row)] });
    },
    setSessionState(id, next) {
      if (!hasSession(id)) return;
      change({ sessions: state.sessions.map((row) => (row.id === id ? { ...row, state: next } : row)) });
    },
  };

  return {
    version: CONTRACT_VERSION,
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ask,
    controls,
  };
}
