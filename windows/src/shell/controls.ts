// The plain theme's basic controls, built from DOM nodes. Text is always set
// with textContent, never parsed as markup.

import { ICONS, type IconName } from "./icons";

type Kind = "default" | "primary" | "quiet";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export interface ButtonOptions {
  kind?: Kind;
  disabled?: boolean;
  onClick?: () => void;
}

export function button(label: string, options: ButtonOptions = {}): HTMLButtonElement {
  const kind = options.kind ?? "default";
  const node = el("button", kind === "default" ? "pk-btn" : `pk-btn pk-btn-${kind}`);
  node.type = "button";
  node.textContent = label;
  node.disabled = options.disabled ?? false;
  if (options.onClick) node.addEventListener("click", options.onClick);
  return node;
}

/** A square button holding only an icon, so the label is required. */
export function iconButton(
  icon: IconName,
  label: string,
  options: { disabled?: boolean; onClick?: () => void } = {},
): HTMLButtonElement {
  const node = el("button", "pk-icon-btn");
  node.type = "button";
  node.setAttribute("aria-label", label);
  node.disabled = options.disabled ?? false;
  node.append(ICONS[icon]());
  if (options.onClick) node.addEventListener("click", options.onClick);
  return node;
}

export function chip(label: string, removeLabel: string, onRemove?: () => void): HTMLSpanElement {
  const node = el("span", "pk-chip");
  const text = document.createElement("span");
  text.textContent = label;
  const remove = el("button", "pk-chip-x");
  remove.type = "button";
  remove.setAttribute("aria-label", removeLabel);
  remove.append(ICONS.x());
  if (onRemove) remove.addEventListener("click", onRemove);
  node.append(text, remove);
  return node;
}

/** A real button with the switch role; it flips its own state when used. */
export function switchControl(
  label: string,
  on: boolean,
  options: { disabled?: boolean; onChange?: (on: boolean) => void } = {},
): HTMLButtonElement {
  const node = el("button", "pk-switch");
  node.type = "button";
  node.setAttribute("role", "switch");
  node.setAttribute("aria-label", label);
  node.setAttribute("aria-checked", String(on));
  node.disabled = options.disabled ?? false;
  node.append(el("span", "pk-switch-knob"));
  node.addEventListener("click", () => {
    const next = node.getAttribute("aria-checked") !== "true";
    node.setAttribute("aria-checked", String(next));
    options.onChange?.(next);
  });
  return node;
}

let fieldCount = 0;

/** A text field with a hidden label and an optional trailing icon button. */
export function field(
  label: string,
  placeholder: string,
  options: { disabled?: boolean; trailing?: HTMLElement } = {},
): HTMLDivElement {
  const id = `pk-field-${++fieldCount}`;
  const node = el("div", options.disabled ? "pk-field is-disabled" : "pk-field");
  const labelNode = el("label", "pk-hidden");
  labelNode.htmlFor = id;
  labelNode.textContent = label;
  const input = document.createElement("input");
  input.id = id;
  input.type = "text";
  input.placeholder = placeholder;
  input.disabled = options.disabled ?? false;
  node.append(labelNode, input);
  if (options.trailing) node.append(options.trailing);
  return node;
}

/** The small coloured dot used beside names; `size` picks the context. */
export function smallDot(size: "default" | "row" | "closed" = "default"): HTMLSpanElement {
  const node = el("span", size === "default" ? "pk-dot" : `pk-dot pk-dot-${size}`);
  node.setAttribute("aria-hidden", "true");
  return node;
}
