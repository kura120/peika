// Small decorative icons. They are hidden from screen readers: the button
// that holds one carries the label.

const NS = "http://www.w3.org/2000/svg";

type Attrs = Record<string, string | number>;

function node(tag: string, attrs: Attrs): SVGElement {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

function icon(size: number, width: number, parts: SVGElement[]): SVGSVGElement {
  const svg = node("svg", {
    viewBox: `0 0 ${size} ${size}`,
    width: size,
    height: size,
    fill: "none",
    stroke: "currentColor",
    "stroke-width": width,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
  });
  svg.append(...parts);
  return svg as SVGSVGElement;
}

const path = (d: string) => node("path", { d });

export const x = () => icon(12, 1.5, [path("M3 3l6 6M9 3l-6 6")]);
export const ok = () => icon(12, 1.6, [path("M2.2 6.4l2.6 2.6 5-5.4")]);
export const mic = () =>
  icon(16, 1.5, [
    node("rect", { x: 6, y: 1.8, width: 4, height: 7.4, rx: 2 }),
    path("M3.6 7.6a4.4 4.4 0 0 0 8.8 0M8 12v2.2"),
  ]);
export const send = () => icon(16, 1.7, [path("M8 13V3.5M4 7l4-4 4 4")]);
export const eye = () =>
  icon(16, 1.5, [
    path("M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8z"),
    node("circle", { cx: 8, cy: 8, r: 1.9 }),
  ]);
export const gear = () =>
  icon(16, 1.5, [
    node("circle", { cx: 8, cy: 8, r: 4.2 }),
    node("circle", { cx: 8, cy: 8, r: 1.4 }),
    path("M8 1.4v2.4M8 12.2v2.4M1.4 8h2.4M12.2 8h2.4M3.3 3.3L5 5M11 11l1.7 1.7M3.3 12.7L5 11M11 5l1.7-1.7"),
  ]);
export const out = () => icon(16, 1.6, [path("M6.5 3.5h6v6M12.5 3.5L4 12")]);
export const down = () => icon(12, 1.5, [path("M3 4.5l3 3 3-3")]);

export type IconName = "x" | "ok" | "mic" | "send" | "eye" | "gear" | "out" | "down";

export const ICONS: Record<IconName, () => SVGSVGElement> = { x, ok, mic, send, eye, gear, out, down };
