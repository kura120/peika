// The pure parts of scripts/scan-src.mjs: the banned names, what a comment
// hides, the allow list; and one run over the real windows/src/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { ALLOW, BANNED, applyAllow, findHits, scan, stripComments } from "../scripts/scan-src.mjs";

const SAMPLES = {
  "innerHTML": "el.innerHTML = html;",
  "insertAdjacentHTML": "el.insertAdjacentHTML('beforeend', html);",
  "outerHTML": "const s = el.outerHTML;",
  "document.write": "document.write(html);",
  "srcdoc": "frame.srcdoc = html;",
  "DOMParser": "const d = new DOMParser();",
  "eval(": "eval(code);",
  "new Function": "const f = new Function('a', 'return a');",
  "fetch(": "const r = await fetch(url);",
  "localStorage": "window.localStorage.getItem('k');",
  "sessionStorage": "sessionStorage.setItem('k', 'v');",
  "indexedDB": "const db = indexedDB.open('x');",
  ": any": "function f(x: any) {}",
  "as any": "const y = x as any;",
  "as unknown as": "const z = x as unknown as Thing;",
};

test("every banned name is found in a made-up text", () => {
  assert.deepEqual(Object.keys(SAMPLES).sort(), BANNED.map((b) => b.name).sort());
  for (const [name, code] of Object.entries(SAMPLES)) {
    const hits = findHits(`const ok = 1;\n${code}\n`);
    assert.deepEqual(hits.map((h) => [h.line, h.name]), [[2, name]], name);
  }
});

test("a name in a comment is not a hit", () => {
  const text = [
    "// never use innerHTML here",
    "const a = 1; // fetch( would be wrong",
    "/* eval( and",
    "   localStorage in a block */",
    "/** as any is banned */",
    "const b = 2;",
  ].join("\n");
  assert.deepEqual(findHits(text), []);
});

test("code after a block comment on the same line, and line numbers, are kept", () => {
  const hits = findHits("/* a\nb */ el.innerHTML = x;\n");
  assert.deepEqual(hits.map((h) => [h.line, h.name]), [[2, "innerHTML"]]);
});

test("a // inside a string is not a comment", () => {
  const hits = findHits('const u = "https://example.com"; el.innerHTML = u;');
  assert.deepEqual(hits.map((h) => h.name), ["innerHTML"]);
});

test("the text of a string is searched: it is reported, as documented", () => {
  assert.deepEqual(findHits('const s = "do not use innerHTML";').map((h) => h.name), ["innerHTML"]);
});

test("a name that only looks like a banned one is not a hit", () => {
  const text = [
    "const retrieval = 1; retrieval(2);",
    "const css = 'overflow-wrap: anywhere';",
    "const t = 'lang: anything';",
    "const f = prefetch(url);",
    "const w = document.writer;",
    "const n = 'can be: any name';",
  ].join("\n");
  assert.deepEqual(findHits(text).map((h) => h.name), [": any"]);
});

test("an allow-listed file is not reported, and another name in it is", () => {
  const hits = findHits("const r = await fetch(u);\nel.innerHTML = r;");
  const left = applyAllow("src/core/sound.ts", hits);
  assert.deepEqual(left.map((h) => h.name), ["innerHTML"]);
});

test("a made-up new file is reported", () => {
  const hits = findHits("const r = await fetch(u);");
  assert.deepEqual(applyAllow("src/core/new-thing.ts", hits).map((h) => h.name), ["fetch("]);
});

test("the allow list holds what exists today and a reason for each", () => {
  const pairs = ALLOW.flatMap((e) => e.names.map((n) => `${e.file} ${n}`)).sort();
  assert.deepEqual(pairs, [
    "src/core/bridge.ts as unknown as",
    "src/core/github.ts as unknown as",
    "src/core/sound.ts as unknown as",
    "src/core/sound.ts fetch(",
    "src/island/app.ts as unknown as",
    "src/views/chat.ts localStorage",
    "src/views/usage.ts localStorage",
  ]);
  for (const entry of ALLOW) assert.ok(entry.reason.length > 10, entry.file);
});

test("stripComments keeps the length and the newlines", () => {
  const text = "a // b\n/* c\nd */ e";
  const out = stripComments(text);
  assert.equal(out.length, text.length);
  assert.equal(out.split("\n").length, 3);
});

test("the real windows/src/ has nothing outside the allow list", async () => {
  const windowsDir = resolve(fileURLToPath(import.meta.url), "..", "..");
  const { violations, files } = await scan(windowsDir);
  assert.ok(files > 20, "it found the source files");
  assert.deepEqual(violations, []);
});
