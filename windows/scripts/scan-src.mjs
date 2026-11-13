// Lists risky patterns in the island's TypeScript (windows/src/), with file and
// line, so a new one cannot slip in unseen:
//
//   node scripts/scan-src.mjs        (or `npm run scan`)
//
// Three groups: ways to turn text into HTML or code (`innerHTML`, `eval(`...),
// ways to reach the network or keep data in the page (`fetch(`,
// `localStorage`...), and ways to switch the type checker off (`: any`,
// `as any`, `as unknown as`). Text from a model, a driver, an agent or a file
// is never turned into HTML, and data from outside is `unknown` until it is
// narrowed; this script only keeps those two rules visible.
//
// It exits with 1 when it finds something that is not in the allow list below,
// and 0 otherwise. It reads only; it has no dependency.
//
// What counts as code: comments (`//` and `/* */`) are blanked before the
// search, so a name in a comment is not a hit. The text of a string IS
// searched, on purpose: a string that holds `innerHTML` is more often a bug
// than a sentence. A `//` inside a regular expression literal is read as the
// start of a comment, which hides the rest of that line; that is a known hole.
// Only `.ts` files are read.

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative, resolve, sep } from "node:path";

// What exists today and is accepted, one line of reason each. A new use
// anywhere else, or of another name in one of these files, is reported.
export const ALLOW = [
  { file: "src/core/sound.ts", names: ["fetch("], reason: "a bundled sound, from the page's own origin" },
  { file: "src/core/sound.ts", names: ["as unknown as"], reason: "the prefixed AudioContext that older WebKit still has" },
  { file: "src/views/chat.ts", names: ["localStorage"], reason: "which chat folders are folded: a view setting, no secret" },
  { file: "src/views/usage.ts", names: ["localStorage"], reason: "the last usage numbers shown, so the view is not empty at launch" },
  { file: "src/core/bridge.ts", names: ["as unknown as"], reason: "the WebView2 object that only Windows puts on window" },
  { file: "src/core/github.ts", names: ["as unknown as"], reason: "the GitHub answer is checked by hand just above" },
  { file: "src/island/app.ts", names: ["as unknown as"], reason: "settings rebuilt from stored JSON that was checked just above" },
];

// Each banned name and the pattern that finds it. `\b` keeps `retrieval(` from
// being `eval(` and `: anywhere` from being `: any`.
export const BANNED = [
  { name: "innerHTML", re: /\binnerHTML\b/ },
  { name: "insertAdjacentHTML", re: /\binsertAdjacentHTML\b/ },
  { name: "outerHTML", re: /\bouterHTML\b/ },
  { name: "document.write", re: /\bdocument\s*\.\s*write(?:ln)?\b/ },
  { name: "srcdoc", re: /\bsrcdoc\b/ },
  { name: "DOMParser", re: /\bDOMParser\b/ },
  { name: "eval(", re: /\beval\s*\(/ },
  { name: "new Function", re: /\bnew\s+Function\b/ },
  { name: "fetch(", re: /\bfetch\s*\(/ },
  { name: "localStorage", re: /\blocalStorage\b/ },
  { name: "sessionStorage", re: /\bsessionStorage\b/ },
  { name: "indexedDB", re: /\bindexedDB\b/ },
  { name: ": any", re: /:\s*any\b/ },
  { name: "as any", re: /\bas\s+any\b/ },
  { name: "as unknown as", re: /\bas\s+unknown\s+as\b/ },
];

// The text with every comment replaced by spaces, newlines kept, so a line
// number in the result is the line number in the file. Strings are walked
// (so a `//` inside "https://..." is not a comment) but left as they are.
export function stripComments(text) {
  let out = "";
  let i = 0;
  let quote = "";
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (quote) {
      out += c;
      if (c === "\\" && i + 1 < text.length) {
        out += next;
        i += 2;
        continue;
      }
      if (c === quote || (c === "\n" && quote !== "`")) quote = "";
      i++;
    } else if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") {
        out += " ";
        i++;
      }
    } else if (c === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        out += text[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < text.length) {
        out += "  ";
        i += 2;
      }
    } else {
      if (c === '"' || c === "'" || c === "`") quote = c;
      out += c;
      i++;
    }
  }
  return out;
}

// Every hit in one file's text: { line, name, text } with the line counted
// from 1 and `text` the code line, trimmed. One line can hold several names.
export function findHits(text) {
  const code = stripComments(text).split("\n");
  const hits = [];
  code.forEach((line, index) => {
    for (const { name, re } of BANNED) {
      if (re.test(line)) hits.push({ line: index + 1, name, text: line.trim() });
    }
  });
  return hits;
}

// The hits that the allow list does not cover. `file` is the path from
// `windows/` with forward slashes, e.g. "src/core/sound.ts".
export function applyAllow(file, hits, allow = ALLOW) {
  return hits.filter(
    (hit) => !allow.some((entry) => entry.file === file && entry.names.includes(hit.name)),
  );
}

// All `.ts` files below a folder, as paths from `windows/` with forward slashes.
async function listTs(root, dir = root) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await listTs(root, full)));
    else if (entry.isFile() && entry.name.endsWith(".ts")) found.push(full);
  }
  return found;
}

// Scans a `windows/` folder and returns { violations, allowed, files }, where
// each violation is { file, line, name, text }.
export async function scan(windowsDir, allow = ALLOW) {
  const srcDir = join(windowsDir, "src");
  const files = (await listTs(srcDir)).map((p) => relative(windowsDir, p).split(sep).join("/")).sort();
  const violations = [];
  let allowed = 0;
  for (const file of files) {
    const hits = findHits(await readFile(join(windowsDir, file), "utf8"));
    const bad = applyAllow(file, hits, allow);
    allowed += hits.length - bad.length;
    for (const hit of bad) violations.push({ file, ...hit });
  }
  return { violations, allowed, files: files.length };
}

async function main() {
  const windowsDir = resolve(fileURLToPath(import.meta.url), "..", "..");
  const { violations, allowed, files } = await scan(windowsDir);
  for (const v of violations) console.log(`${v.file}:${v.line}  ${v.name}  ${v.text}`);
  console.log(`${files} files, ${allowed} allowed, ${violations.length} to look at.`);
  if (violations.length) process.exitCode = 1;
}

// Only when run as a script, so a test can import the functions above.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
