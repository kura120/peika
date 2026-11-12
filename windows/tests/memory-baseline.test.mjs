// The pure parts of scripts/memory-baseline.mjs: the process tree, the roles,
// the totals and the median. Fed a made-up process list; no app needed.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildKind, buildTree, formatTable, median, parseArgs, parseLinuxStat, parseLinuxStatus,
  parseWindowsList, roleOf, summarize, toReport, totalsOf,
} from "../scripts/memory-baseline.mjs";

const M = 1024 * 1024;
const proc = (pid, ppid, name, commandLine, privMB, wsMB, path = "") => ({
  pid, ppid, name, commandLine, path, privateBytes: privMB * M, workingSet: wsMB * M,
});

const EXE = "C:\\dev\\coucou\\windows\\target\\debug\\peika.exe";
const LIST = [
  proc(4, 0, "System", "", 1, 1),
  proc(100, 4, "explorer.exe", "", 50, 90),
  proc(200, 100, "peika.exe", "peika.exe", 40, 60, EXE),
  proc(201, 200, "msedgewebview2.exe", "msedgewebview2.exe --embedded-browser-webview=1", 30, 80),
  proc(202, 201, "msedgewebview2.exe", "msedgewebview2.exe --type=renderer --lang=en", 70, 120),
  proc(203, 201, "msedgewebview2.exe", "msedgewebview2.exe --type=renderer --lang=en", 50, 100),
  proc(204, 201, "msedgewebview2.exe", "msedgewebview2.exe --type=gpu-process", 20, 60),
  proc(205, 204, "msedgewebview2.exe", "msedgewebview2.exe --type=utility --utility-sub-type=network.mojom.NetworkService", 10, 30),
  proc(300, 100, "peika-hook.exe", "peika-hook.exe", 5, 9),
  proc(301, 100, "msedgewebview2.exe", "msedgewebview2.exe --type=renderer", 999, 999),
];

test("the tree holds Peika and everything below it, and nothing else", () => {
  const rows = buildTree(LIST);
  assert.deepEqual(rows.map((r) => r.pid), [200, 201, 202, 203, 204, 205]);
  assert.deepEqual(rows.map((r) => r.depth), [0, 1, 2, 2, 2, 3]);
});

test("a grandchild is counted, an unrelated page process and peika-hook are not", () => {
  const pids = buildTree(LIST).map((r) => r.pid);
  assert.ok(pids.includes(205));
  assert.ok(!pids.includes(301));
  assert.ok(!pids.includes(300));
});

test("roles come from the command line", () => {
  assert.deepEqual(buildTree(LIST).map((r) => r.role), ["peika", "browser", "renderer", "renderer", "gpu", "utility"]);
  assert.equal(roleOf("msedgewebview2.exe", "x --type=crashpad-handler"), "crashpad");
  assert.equal(roleOf("WebKitWebProcess", ""), "renderer");
  assert.equal(roleOf("WebKitNetworkProcess", ""), "network");
  assert.equal(roleOf("WebKitGPUProcess", ""), "gpu");
});

test("no Peika means no rows", () => {
  assert.deepEqual(buildTree(LIST.filter((p) => p.pid !== 200)), []);
});

test("a loop of parent ids ends", () => {
  const loop = [proc(1, 2, "peika", "", 1, 1), proc(2, 1, "webkitwebprocess", "", 1, 1)];
  assert.equal(buildTree(loop).length, 2);
});

test("totals: Peika itself, the pages, everything", () => {
  const t = totalsOf(buildTree(LIST));
  assert.equal(t.peika.privateBytes, 40 * M);
  assert.equal(t.pages.privateBytes, 180 * M);
  assert.equal(t.pages.workingSet, 390 * M);
  assert.equal(t.all.privateBytes, 220 * M);
  assert.equal(t.all.workingSet, 450 * M);
});

test("the median of an odd, an even and an empty list", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), 0);
  assert.equal(median([1, 100, 2]), 2);
});

test("summarize takes the median per process and of the totals", () => {
  const sample = (peikaMB) => buildTree(LIST.map((p) => (p.pid === 200 ? { ...p, privateBytes: peikaMB * M } : p)));
  const { rows, totals } = summarize([sample(40), sample(900), sample(42)]);
  assert.equal(rows.find((r) => r.pid === 200).privateBytes, 42 * M);
  assert.equal(totals.peika.privateBytes, 42 * M);
  assert.equal(totals.all.privateBytes, 222 * M);
});

test("a page seen in only one sample is still reported", () => {
  const { rows } = summarize([buildTree(LIST), buildTree(LIST.filter((p) => p.pid !== 203))]);
  assert.equal(rows.length, 6);
  assert.equal(rows.find((r) => r.pid === 203).seen, 1);
});

test("the build kind comes from the path", () => {
  assert.equal(buildKind(EXE), "debug");
  assert.equal(buildKind("/home/a/peika/windows/target/release/peika"), "release");
  assert.equal(buildKind("C:\\Users\\a\\AppData\\Local\\Peika\\peika.exe"), "installed");
  assert.equal(buildKind(""), "unknown");
});

test("the table names the rows and warns about a debug build", () => {
  const { rows, totals } = summarize([buildTree(LIST)]);
  const text = formatTable({ label: "island hidden", build: "debug", executable: EXE, samples: 1, rows, totals });
  assert.match(text, /State: island hidden/);
  assert.match(text, /not a baseline/);
  assert.match(text, /Peika itself\s+peika\s+200\s+40\.0\s+60\.0/);
  assert.match(text, /Total: everything\s+220\.0\s+450\.0/);
});

test("the JSON report has the label, the build and the totals in MB", () => {
  const { rows, totals } = summarize([buildTree(LIST)]);
  const report = toReport({ label: "x", time: "t", build: "debug", executable: EXE, samples: 1, rows, totals });
  assert.equal(report.label, "x");
  assert.equal(report.totals.pages.privateMB, 180);
  assert.equal(report.rows.length, 6);
});

test("the Windows list parses, one process or many", () => {
  const one = { ProcessId: 1, ParentProcessId: 0, Name: "peika.exe", CommandLine: null, ExecutablePath: EXE, WorkingSetSize: 10, PrivatePageCount: 5 };
  assert.equal(parseWindowsList(JSON.stringify(one))[0].privateBytes, 5);
  assert.equal(parseWindowsList(JSON.stringify([one, one])).length, 2);
  assert.equal(parseWindowsList(JSON.stringify(one))[0].commandLine, "");
});

test("the Linux files parse, a name with a bracket included", () => {
  assert.equal(parseLinuxStat("12 (my) app) S 7 12 12 0 -1"), 7);
  const status = "Name:\tpeika\nVmRSS:\t   2048 kB\nRssAnon:\t   1024 kB\n";
  assert.deepEqual(parseLinuxStatus(status), { name: "peika", workingSet: 2048 * 1024, privateBytes: 1024 * 1024 });
});

test("the arguments", () => {
  assert.deepEqual(parseArgs([]), { samples: 5, every: 1000, label: "", json: false });
  assert.deepEqual(parseArgs(["--samples", "3", "--every", "0", "--label", "a b", "--json"]), { samples: 3, every: 0, label: "a b", json: true });
  assert.ok(parseArgs(["--samples", "0"]).error);
  assert.ok(parseArgs(["--nope"]).error);
  assert.ok(parseArgs(["--label"]).error);
});
