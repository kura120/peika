// The dot in its six states, drawn still. Colour comes from the text colour
// of the svg (set in controls.css), so a theme can recolour it.

const NS = "http://www.w3.org/2000/svg";

type Attrs = Record<string, string | number>;

export type DotState = "resting" | "listening" | "thinking" | "pointing" | "acting" | "needsYou";

export const DOT_STATES: DotState[] = ["resting", "listening", "thinking", "pointing", "acting", "needsYou"];

function node(tag: string, attrs: Attrs): SVGElement {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

const disc = (r: number, extra: Attrs = {}) => node("circle", { cx: 32, cy: 22, r, fill: "currentColor", ...extra });
const ring = (r: number, opacity: number, extra: Attrs = {}) =>
  node("circle", { cx: 32, cy: 22, r, fill: "none", stroke: "currentColor", "stroke-width": 1.5, opacity, ...extra });
const pointer = (d: string) => node("path", { d, fill: "currentColor" });

function frame(w: number, h: number, className: string, parts: SVGElement[]): SVGSVGElement {
  const svg = node("svg", {
    viewBox: `0 0 ${w} ${h}`,
    width: w,
    height: h,
    class: className,
    "aria-hidden": "true",
    focusable: "false",
  });
  svg.append(...parts);
  return svg as SVGSVGElement;
}

export function dot(state: DotState): SVGSVGElement {
  const base = "pk-dot-svg";
  switch (state) {
    case "resting":
      return frame(64, 44, base, [disc(6)]);
    case "listening":
      return frame(64, 44, base, [disc(6), ring(11.5, 0.55), ring(17, 0.25)]);
    case "thinking":
      return frame(64, 44, base, [
        disc(6),
        node("path", {
          d: "M32 9A13 13 0 0 1 45 22",
          fill: "none",
          stroke: "currentColor",
          "stroke-width": 2.5,
          "stroke-linecap": "round",
        }),
      ]);
    case "pointing":
      return frame(64, 44, base, [pointer("M20 8L37 12.5A10 10 0 1 1 24.5 25Z")]);
    case "acting":
      return frame(64, 44, base, [
        pointer("M24 8L41 12.5A10 10 0 1 1 28.5 25Z"),
        node("path", {
          d: "M4 38C12 37 18 33 22 27",
          fill: "none",
          stroke: "currentColor",
          "stroke-width": 2,
          "stroke-dasharray": "3 4",
          "stroke-linecap": "round",
        }),
      ]);
    case "needsYou":
      // The amber class is on each circle as well as on the svg, so the
      // colour is on the parts themselves and not only inherited.
      return frame(64, 44, `${base} pk-dot-amber`, [
        ring(11.5, 0.6, { class: "pk-dot-amber" }),
        disc(6, { class: "pk-dot-amber" }),
      ]);
  }
}

/** The dot while Peika speaks: a small mark with two soft rings. */
export function talkingDot(): SVGSVGElement {
  const ringAt = (r: number, opacity: number) =>
    node("circle", { cx: 15, cy: 15, r, fill: "none", stroke: "currentColor", "stroke-width": 1.5, opacity });
  return frame(30, 30, "pk-dot-svg", [
    ringAt(14, 0.25),
    ringAt(9.5, 0.55),
    node("circle", { cx: 15, cy: 15, r: 5, fill: "currentColor" }),
  ]);
}
