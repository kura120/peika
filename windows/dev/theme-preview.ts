// Dev harness: the plain theme's colours, type, controls and dot, light and
// dark side by side. Not part of the app bundle; nothing in the app imports it.

import "../src/shell/tokens.css";
import "../src/shell/controls.css";
import { button, chip, field, iconButton, smallDot, switchControl } from "../src/shell/controls";
import { dot, DOT_STATES, talkingDot } from "../src/shell/dot";
import { TEXT } from "../src/shell/text";

const TOKENS = [
  "--bg-desktop", "--surface", "--border", "--border-soft", "--divider", "--row-selected",
  "--field", "--chip", "--code", "--btn-border", "--text", "--text-muted",
  "--iris", "--iris-hover", "--iris-tint", "--iris-tint-border", "--iris-tint-text",
  "--amber", "--amber-tint", "--amber-text", "--red", "--switch-off",
];

const AGENT_COLOURS = ["#D97757", "#4F8DF7", "#14B8A6", "var(--text)"];

type Look = "rest" | "hover" | "focus" | "disabled";
const LOOKS: Look[] = ["rest", "hover", "focus", "disabled"];

function div(className?: string, ...children: (Node | string)[]): HTMLDivElement {
  const node = document.createElement("div");
  if (className) node.className = className;
  node.append(...children);
  return node;
}

function heading(tag: "h1" | "h2", text: string): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

/** Marks a control as showing hover or focus without a pointer or a key. */
function show<T extends HTMLElement>(node: T, look: Look): T {
  if (look === "hover") node.classList.add("is-hover");
  if (look === "focus") node.classList.add("is-focus");
  return node;
}

function colours(panel: HTMLElement): HTMLElement {
  const style = getComputedStyle(panel);
  const grid = div("swatches");
  for (const name of TOKENS) {
    const chipBox = document.createElement("i");
    chipBox.style.background = `var(${name})`;
    const label = div(undefined, name);
    const value = document.createElement("code");
    value.textContent = style.getPropertyValue(name).trim();
    label.append(value);
    const item = div("swatch", chipBox, label);
    grid.append(item);
  }
  return grid;
}

function typeScale(): HTMLElement {
  const box = div();
  for (const size of TEXT.sizes) {
    const line = div("row");
    line.style.fontSize = `${size.px}px`;
    line.textContent = size.label;
    box.append(line);
  }
  const title = div("row", TEXT.title);
  title.style.fontWeight = "600";
  title.style.fontSize = "14.5px";
  const mono = div("row");
  const code = document.createElement("span");
  code.className = "code-line pk-mono";
  code.textContent = TEXT.command;
  const file = document.createElement("span");
  file.className = "pk-mono";
  file.style.fontSize = "12.5px";
  file.textContent = TEXT.fileName;
  mono.append(code, file);
  const agents = div("agents");
  TEXT.agentNames.forEach((name, i) => {
    const mark = smallDot("row");
    mark.style.background = AGENT_COLOURS[i] ?? "var(--text)";
    const item = document.createElement("span");
    item.append(mark, name);
    agents.append(item);
  });
  const roles = document.createElement("ul");
  roles.className = "roles";
  for (const text of TEXT.roles) {
    const li = document.createElement("li");
    li.textContent = text;
    roles.append(li);
  }
  box.append(title, mono, agents, div("row"), roles);
  return box;
}

function controls(): HTMLElement {
  const grid = div("states");
  grid.append(div("head"), ...TEXT.states.map((s) => div("head", s)));

  const line = (name: string, make: (look: Look) => HTMLElement, cell = "") => {
    grid.append(div("head", name));
    for (const look of LOOKS) {
      const cellNode = div(cell, make(look));
      grid.append(cellNode);
    }
  };

  line("Button", (look) => show(button(TEXT.allow, { disabled: look === "disabled" }), look));
  line("Primary", (look) => show(button(TEXT.allow, { kind: "primary", disabled: look === "disabled" }), look));
  line("Quiet", (look) => show(button(TEXT.deny, { kind: "quiet", disabled: look === "disabled" }), look));
  line("Icon button", (look) => show(iconButton("gear", "Settings", { disabled: look === "disabled" }), look));
  line("Chip", (look) => {
    const node = chip(TEXT.chip, TEXT.chipRemove);
    const remove = node.querySelector("button");
    if (remove) {
      show(remove, look);
      remove.disabled = look === "disabled";
    }
    return node;
  });
  line("Switch off", (look) => show(switchControl(TEXT.switchLabel, false, { disabled: look === "disabled" }), look));
  line("Switch on", (look) => show(switchControl(TEXT.switchLabel, true, { disabled: look === "disabled" }), look));
  line(
    "Field",
    (look) =>
      show(
        field(TEXT.fieldLabel, TEXT.placeholder, {
          disabled: look === "disabled",
          trailing: iconButton("send", "Send", { disabled: look === "disabled" }),
        }),
        look,
      ),
    "field-cell",
  );
  return grid;
}

function dots(): HTMLElement {
  const wrap = div("dots");
  DOT_STATES.forEach((state, i) => {
    const fig = document.createElement("figure");
    const cap = document.createElement("figcaption");
    cap.textContent = TEXT.dotNames[i] ?? state;
    fig.append(dot(state), cap);
    wrap.append(fig);
  });
  const talk = document.createElement("figure");
  const cap = document.createElement("figcaption");
  cap.textContent = TEXT.talking;
  talk.append(talkingDot(), cap);
  wrap.append(talk);

  const sizes = div("row");
  sizes.style.marginTop = "12px";
  sizes.append(smallDot(), smallDot("row"), smallDot("closed"));
  return div(undefined, wrap, sizes);
}

function closedIsland(): HTMLElement {
  const desk = div("desk");
  desk.setAttribute("role", "img");
  desk.setAttribute("aria-label", TEXT.closedIsland);
  desk.append(div("island", smallDot()));
  return desk;
}

function panel(theme: "light" | "dark"): HTMLElement {
  const node = div("panel pk-text");
  node.dataset.theme = theme;
  node.append(heading("h1", theme === "light" ? TEXT.light : TEXT.dark));
  // Swatch values are read after the panel is in the page, so they are the real ones.
  const swatchHost = div();
  node.append(
    heading("h2", TEXT.colours), swatchHost,
    heading("h2", TEXT.type), typeScale(),
    heading("h2", TEXT.controls), controls(),
    heading("h2", TEXT.dots), dots(),
    heading("h2", TEXT.island), closedIsland(),
  );
  queueMicrotask(() => swatchHost.append(colours(node)));
  return node;
}

document.getElementById("panels")!.append(panel("light"), panel("dark"));
