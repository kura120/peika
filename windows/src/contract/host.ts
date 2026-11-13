// The one thing a theme is given. It reaches nothing else.

import type { Ask, AskResult } from "./asks";
import type { Snapshot } from "./types";
import type { CONTRACT_VERSION } from "./version";

export interface ThemeHost {
  readonly version: typeof CONTRACT_VERSION;
  /** What the theme is told now. */
  snapshot(): Snapshot;
  /** Calls the listener with the parts that changed. Returns the function that stops listening: whoever subscribes owns it. */
  subscribe(listener: (change: Partial<Snapshot>) => void): () => void;
  ask(ask: Ask): Promise<AskResult>;
}
