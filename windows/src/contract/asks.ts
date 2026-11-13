// What a theme may ask of Peika. The list is closed on purpose, and every
// name here is a promise: an ability is never renamed within a version.
//
// There is no ask that answers a request, presses Allow, moves or closes the
// request window, reads a secret, or changes who the caller is. Those belong
// to Peika's own window and to the user's own click; do not add one.

import type { PermissionGroup, PermissionLevel } from "./types";

export type Ask =
  | { readonly type: "show" }
  | { readonly type: "hide" }
  | { readonly type: "resize"; readonly width: number; readonly height: number }
  // Also how a reply to an agent is sent.
  | { readonly type: "send-words"; readonly text: string; readonly to: { readonly kind: "peika" } | { readonly kind: "session"; readonly id: string } }
  | { readonly type: "open-session"; readonly id: string }
  | { readonly type: "open-settings" }
  | { readonly type: "set-permission"; readonly modelId: string; readonly group: PermissionGroup; readonly level: PermissionLevel }
  | { readonly type: "set-driver"; readonly id: string; readonly on: boolean }
  | { readonly type: "clear-marks" }
  | { readonly type: "undo"; readonly entryId: string }
  | { readonly type: "forget"; readonly entryId: string };

/**
 * The outcome of an ask. It is always a value: an ask never throws and never
 * hangs. `waitingForClick` is true when the change needs the user's own click
 * in Peika's window (a permission, or a driver turned on).
 */
export type AskResult =
  | { readonly ok: true; readonly waitingForClick?: boolean }
  | { readonly ok: false; readonly reason: string };
