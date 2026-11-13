// The plain theme's tokens, its dot and its icons (src/shell/). The files are
// read as text where the question is "is this value written down", and run on
// a fake DOM where the question is "what gets drawn".

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { installFakeDom } from "./fakedom.mjs";

installFakeDom();
const { dot, talkingDot, DOT_STATES } = await import("../src/shell/dot.ts");
const icons = await import("../src/shell/icons.ts");

const shellDir = fileURLToPath(new URL("../src/shell/", import.meta.url));
// Comments are dropped so a selector is only its own text.
const css = readFileSync(join(shellDir, "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const NAMES = [
  "bg-desktop", "surface", "border", "border-soft", "divider", "row-selected", "field", "chip", "code",
  "btn-border", "text", "text-muted", "iris", "iris-hover", "iris-tint", "iris-tint-border", "iris-tint-text",
  "amber", "amber-tint", "amber-text", "red", "switch-off", "shadow-island", "shadow-card",
  "r-island", "r-card", "r-btn", "r-field", "r-line", "r-row",
];
const COLOUR_NAMES = NAMES.filter((n) => !n.startsWith("shadow-") && !n.startsWith("r-"));

const LIGHT = {
  "bg-desktop": "#C5CCD4", surface: "#FFFFFF", border: "#D9DDE2", "border-soft": "#DFE2E6",
  divider: "#E6E8EB", "row-selected": "#EDEFF2", field: "#F1F2F5", chip: "#E3E6EA", code: "#F3F4F6",
  "btn-border": "#CDD2D8", text: "#17191C", "text-muted": "#5A6068", iris: "#5B4FE9", "iris-hover": "#2F27A8",
  "iris-tint": "#EEEDFD", "iris-tint-border": "#CBC6F7", "iris-tint-text": "#3F36B8", amber: "#E0780B",
  "amber-tint": "#FFF1DB", "amber-text": "#7A3B00", red: "#C4292B", "switch-off": "#B4BAC2",
};

/** The body of the first rule whose selector list matches `test`. */
function block(selectorTest) {
  const rules = [...css.matchAll(/([^{}@][^{}]*)\{([^{}]*)\}/g)];
  const found = rules.find((m) => selectorTest(m[1].trim()));
  assert.ok(found, "rule not found");
  return found[2];
}
const names = (body) => [...body.matchAll(/(--[a-z-]+)\s*:/g)].map((m) => m[1].slice(2));
const value = (body, name) => body.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`))?.[1].trim();

const light = block((s) => s.startsWith(":root,"));
const darkMedia = block((s) => s.startsWith(':root:not([data-theme="light"])'));
const darkForced = block((s) => s.startsWith(':root[data-theme="dark"]'));

test("every token is defined in the light block and in both dark blocks", () => {
  for (const name of NAMES) assert.ok(names(light).includes(name), `light ${name}`);
  for (const name of NAMES.filter((n) => !n.startsWith("r-"))) {
    assert.ok(names(darkMedia).includes(name), `dark media ${name}`);
    assert.ok(names(darkForced).includes(name), `dark forced ${name}`);
  }
  assert.deepEqual([...names(darkMedia)].sort(), [...names(darkForced)].sort());
});

test("the light colours are the ones on the design boards", () => {
  for (const [name, hex] of Object.entries(LIGHT)) assert.equal(value(light, name), hex, name);
  assert.equal(value(light, "r-island"), "0 0 16px 16px");
  assert.equal(value(light, "r-card"), "14px");
});

test("dark has a colour for every light colour, and a forced light panel is possible", () => {
  for (const name of COLOUR_NAMES) assert.match(value(darkForced, name), /^#[0-9A-F]{6}$/i, name);
  assert.match(css, /\[data-theme="light"\]/);
});

test("no file in src/shell reaches for the network, storage, markup strings or other folders", () => {
  const banned = ["innerHTML", "insertAdjacentHTML", "fetch(", "localStorage", "@import", "url(http"];
  for (const file of readdirSync(shellDir)) {
    const text = readFileSync(join(shellDir, file), "utf8");
    for (const word of banned) assert.ok(!text.includes(word), `${file} contains ${word}`);
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      assert.ok(m[1].startsWith("./"), `${file} imports ${m[1]}`);
    }
  }
});

const kinds = (svg, tag) => svg.find(tag).length;

test("the dot draws six states", () => {
  assert.equal(DOT_STATES.length, 6);
  const resting = dot("resting");
  assert.equal(kinds(resting, "circle"), 1);
  assert.equal(resting.getAttribute("viewBox"), "0 0 64 44");

  assert.equal(kinds(dot("listening"), "circle"), 3);

  const thinking = dot("thinking");
  assert.equal(kinds(thinking, "circle"), 1);
  assert.equal(kinds(thinking, "path"), 1);

  const pointing = dot("pointing");
  assert.equal(kinds(pointing, "path"), 1);
  assert.equal(kinds(pointing, "circle"), 0);

  assert.equal(kinds(dot("acting"), "path"), 2);
  assert.equal(kinds(dot("acting"), "circle"), 0);
});

test("needs you is two circles in the amber colour", () => {
  const svg = dot("needsYou");
  const circles = svg.find("circle");
  assert.equal(circles.length, 2);
  // The fake element keeps a class set as an attribute (as the svg code does) there.
  for (const c of circles) assert.equal(c.getAttribute("class"), "pk-dot-amber");
  assert.match(readFileSync(join(shellDir, "controls.css"), "utf8"), /\.pk-dot-amber\s*\{\s*color:\s*var\(--amber\)/);
});

test("the talking dot has three circles in a 30 by 30 box", () => {
  const svg = talkingDot();
  assert.equal(svg.getAttribute("viewBox"), "0 0 30 30");
  assert.equal(kinds(svg, "circle"), 3);
});

test("every icon is hidden from screen readers and has no title", () => {
  const made = Object.entries(icons).filter(([, v]) => typeof v === "function");
  assert.equal(made.length, 8);
  for (const [name, make] of made) {
    const svg = make();
    assert.equal(svg.getAttribute("aria-hidden"), "true", name);
    assert.equal(svg.find("title").length, 0, name);
    assert.equal(svg.getAttribute("title"), null, name);
  }
});
