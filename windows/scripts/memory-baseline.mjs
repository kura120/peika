// How much memory does a RUNNING Peika use? Finds the Peika process and every
// process below it (the web page processes: WebView2 on Windows, WebKitGTK on
// Linux), reads their memory a few times and prints the median, so that later
// work has a baseline to compare against (doc/rules/system.md, section 6).
//
//   node scripts/memory-baseline.mjs --label "island hidden, voice off"
//
// Options: `--samples <n>` (default 5), `--every <ms>` (default 1000),
// `--label "<text>"` (says which state is measured; printed and put in the
// JSON), `--json` (one JSON object in place of the table, to save and compare).
//
// It only reads. It never starts, stops or changes Peika, and it needs no
// build: start Peika yourself, put it in the state you want to measure, wait
// for it to settle, then run this. Windows reads the process list with one
// PowerShell call (Get-CimInstance); Linux reads /proc. Other systems are not
// supported. The numbers of a debug build are not a baseline (it is bigger and
// slower than the one people install), so the script says which kind it saw.
//
// Two numbers per process, in MB: "private" is what only that process holds
// (Windows PrivatePageCount, Linux RssAnon), the part that goes away when it
// is closed; "working set" is what is in RAM now, shared libraries included
// (Windows WorkingSetSize, Linux VmRSS). Adding working sets over several
// processes counts shared pages more than once, so compare private first.

import { execFile } from "node:child_process";
import { readdir, readFile, readlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const MB = 1024 * 1024;

// What the Peika process itself is called. Compared without case, because
// Windows does not care and `peika-hook` must not match.
export const PEIKA_NAMES = ["peika.exe", "peika"];

// The role of a process from its name and command line. Chromium (WebView2)
// puts it in `--type=`; the browser process, the one that has none, is the
// page host. WebKitGTK has one executable per role instead.
export function roleOf(name, commandLine) {
  const lower = String(name || "").toLowerCase();
  if (lower.startsWith("webkit")) {
    if (lower.includes("network")) return "network";
    if (lower.includes("gpu")) return "gpu";
    if (lower.includes("web")) return "renderer";
    return "other";
  }
  const cmd = String(commandLine || "");
  const type = /--type=([\w-]+)/.exec(cmd);
  if (type) {
    switch (type[1]) {
      case "renderer": return "renderer";
      case "gpu-process": return "gpu";
      case "utility": return "utility";
      case "crashpad-handler": return "crashpad";
      default: return type[1];
    }
  }
  // Crashpad's handler is launched with its own switch and no `--type=` on
  // some builds.
  if (/crashpad/i.test(lower) || /--crashpad|crashpad-handler/i.test(cmd)) return "crashpad";
  return "browser";
}

// Which Peika processes are there, and everything below each, parent to child
// all the way down. `list` is [{ pid, ppid, name, commandLine, path, workingSet,
// privateBytes }] for the whole machine. A Peika that is itself below another
// Peika is not a second root. The `seen` set stops a loop: process ids are
// reused, so an old parent id can point back down the tree.
export function buildTree(list) {
  const byParent = new Map();
  const byPid = new Map();
  for (const proc of list) {
    byPid.set(proc.pid, proc);
    if (!byParent.has(proc.ppid)) byParent.set(proc.ppid, []);
    byParent.get(proc.ppid).push(proc);
  }
  const isPeika = (proc) => PEIKA_NAMES.includes(String(proc.name).toLowerCase());
  const roots = list.filter((proc) => isPeika(proc) && !(byPid.has(proc.ppid) && isPeika(byPid.get(proc.ppid))));
  const rows = [];
  const seen = new Set();
  const walk = (proc, depth) => {
    if (seen.has(proc.pid)) return;
    seen.add(proc.pid);
    rows.push({
      pid: proc.pid,
      ppid: proc.ppid,
      depth,
      name: proc.name,
      role: depth === 0 ? "peika" : roleOf(proc.name, proc.commandLine),
      path: proc.path || "",
      privateBytes: proc.privateBytes,
      workingSet: proc.workingSet,
    });
    for (const child of byParent.get(proc.pid) || []) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return rows;
}

// Sums in bytes: Peika itself (the Rust process), the pages (everything below
// it) and both together.
export function totalsOf(rows) {
  const sum = (part) => ({
    privateBytes: part.reduce((n, row) => n + row.privateBytes, 0),
    workingSet: part.reduce((n, row) => n + row.workingSet, 0),
  });
  const own = rows.filter((row) => row.role === "peika");
  const pages = rows.filter((row) => row.role !== "peika");
  return { peika: sum(own), pages: sum(pages), all: sum(rows) };
}

// The median of a list of numbers; the mean of the two middle ones when there
// is an even count. A median, not a mean, because one sample taken while a page
// reloads should not move the baseline.
export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Several samples (each one is the rows of `buildTree`) into one result. Rows
// are matched by process id; a process seen in only some samples (a page that
// came or went) takes the median of those it was seen in. Totals are the median
// of each sample's total, not the total of the medians, so they are a number
// that was really there.
export function summarize(samples) {
  const byPid = new Map();
  for (const rows of samples) {
    for (const row of rows) {
      if (!byPid.has(row.pid)) byPid.set(row.pid, { first: row, priv: [], ws: [] });
      byPid.get(row.pid).priv.push(row.privateBytes);
      byPid.get(row.pid).ws.push(row.workingSet);
    }
  }
  const rows = [...byPid.values()].map(({ first, priv, ws }) => ({
    ...first,
    privateBytes: median(priv),
    workingSet: median(ws),
    seen: priv.length,
  }));
  const per = samples.map(totalsOf);
  const totals = {};
  for (const key of ["peika", "pages", "all"]) {
    totals[key] = {
      privateBytes: median(per.map((t) => t[key].privateBytes)),
      workingSet: median(per.map((t) => t[key].workingSet)),
    };
  }
  return { rows, totals };
}

// A debug build's numbers are not a baseline, so say which this is, from where
// it lives in the build folder.
export function buildKind(path) {
  const p = String(path || "").replace(/\\/g, "/").toLowerCase();
  if (!p) return "unknown";
  if (p.includes("/target/debug/")) return "debug";
  if (p.includes("/target/release/")) return "release";
  return "installed";
}

export const toMB = (bytes) => Math.round((bytes / MB) * 10) / 10;
const mb = (bytes) => toMB(bytes).toFixed(1);

// The table, as plain lines. One row for Peika itself, one for each page
// process with its role, then the totals.
export function formatTable({ label, build, executable, samples, rows, totals }) {
  const lines = [];
  if (label) lines.push(`State: ${label}`);
  lines.push(`Program: ${executable || "(unknown)"}`);
  lines.push(
    build === "debug"
      ? "Build: debug. A debug build uses more than the one people install, so these numbers are not a baseline."
      : `Build: ${build}`,
  );
  lines.push(`Samples: ${samples} (median)`);
  lines.push("");
  const head = ["Process", "Role", "Pid", "Private MB", "Working set MB"];
  const body = rows.map((row) => [
    row.role === "peika" ? "Peika itself" : "  " + row.name,
    row.role === "peika" ? "peika" : row.role,
    String(row.pid),
    mb(row.privateBytes),
    mb(row.workingSet),
  ]);
  const total = (name, t) => [name, "", "", mb(t.privateBytes), mb(t.workingSet)];
  const all = [head, ...body, total("Total: Peika itself", totals.peika), total("Total: the pages", totals.pages), total("Total: everything", totals.all)];
  const widths = head.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  const fmt = (r) => r.map((cell, i) => (i < 3 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join("  ");
  const rule = widths.map((w) => "-".repeat(w)).join("  ");
  lines.push(fmt(head), rule, ...body.map(fmt), rule, ...all.slice(1 + body.length).map(fmt));
  return lines.join("\n");
}

// The JSON for `--json`: megabytes with one decimal, the way the table shows
// them, so two saved results can be compared by eye or by a script.
export function toReport({ label, time, build, executable, samples, rows, totals }) {
  const m = (t) => ({ privateMB: toMB(t.privateBytes), workingSetMB: toMB(t.workingSet) });
  return {
    label: label || "",
    time,
    build,
    executable: executable || "",
    samples,
    rows: rows.map((row) => ({ pid: row.pid, name: row.name, role: row.role, ...m(row) })),
    totals: { peika: m(totals.peika), pages: m(totals.pages), all: m(totals.all) },
  };
}

// The arguments. Returns { error } with a plain sentence for anything wrong.
export function parseArgs(argv) {
  const out = { samples: 5, every: 1000, label: "", json: false };
  const number = (flag, value, min) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= min ? n : null;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") out.json = true;
    else if (arg === "--label") {
      if (i + 1 >= argv.length) return { error: "--label needs a text." };
      out.label = argv[++i];
    } else if (arg === "--samples") {
      const n = number(arg, argv[++i], 1);
      if (n === null) return { error: "--samples needs a whole number of at least 1." };
      out.samples = n;
    } else if (arg === "--every") {
      const n = number(arg, argv[++i], 0);
      if (n === null) return { error: "--every needs a whole number of milliseconds." };
      out.every = n;
    } else return { error: `I do not know ${arg}. Options: --samples <n>, --every <ms>, --label "<text>", --json.` };
  }
  return out;
}

// ---- Asking the system (the only part that needs a running machine) ----

function powershell(script) {
  return new Promise((done, fail) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => (err ? fail(err) : done(stdout)),
    );
  });
}

// UTF-8 out, so a path with an accent comes back whole. A single process comes
// out of ConvertTo-Json as an object, not a list; `@()` and the check below
// cover both.
const WINDOWS_QUERY =
  "[Console]::OutputEncoding = [Text.Encoding]::UTF8; " +
  "@(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine, ExecutablePath, WorkingSetSize, PrivatePageCount) " +
  "| ConvertTo-Json -Compress";

export function parseWindowsList(json) {
  const data = JSON.parse(json);
  return (Array.isArray(data) ? data : [data]).map((p) => ({
    pid: p.ProcessId,
    ppid: p.ParentProcessId,
    name: p.Name || "",
    commandLine: p.CommandLine || "",
    path: p.ExecutablePath || "",
    workingSet: Number(p.WorkingSetSize) || 0,
    privateBytes: Number(p.PrivatePageCount) || 0,
  }));
}

async function listWindows() {
  return parseWindowsList(await powershell(WINDOWS_QUERY));
}

// Linux: parent from /proc/<pid>/stat (the field after the closing bracket of
// the name, which may itself hold spaces or brackets), memory in kB from
// /proc/<pid>/status. A process can exit between the listing and the read;
// that one is skipped.
export function parseLinuxStat(text) {
  const rest = text.slice(text.lastIndexOf(")") + 2).split(" ");
  return Number(rest[1]);
}

export function parseLinuxStatus(text) {
  const kb = (key) => {
    const m = new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, "m").exec(text);
    return m ? Number(m[1]) * 1024 : 0;
  };
  const name = /^Name:\s+(.*)$/m.exec(text);
  return { name: name ? name[1].trim() : "", workingSet: kb("VmRSS"), privateBytes: kb("RssAnon") };
}

async function listLinux() {
  const list = [];
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const [stat, status, cmdline] = await Promise.all([
        readFile(`/proc/${entry}/stat`, "utf8"),
        readFile(`/proc/${entry}/status`, "utf8"),
        readFile(`/proc/${entry}/cmdline`, "utf8"),
      ]);
      const info = parseLinuxStatus(status);
      let path = "";
      try {
        path = await readlink(`/proc/${entry}/exe`);
      } catch {
        // Not ours to read (another user's process): no path, still counted.
      }
      list.push({ pid: Number(entry), ppid: parseLinuxStat(stat), name: info.name, commandLine: cmdline.replace(/\0/g, " "), path, workingSet: info.workingSet, privateBytes: info.privateBytes });
    } catch {
      // Gone between the listing and the read.
    }
  }
  return list;
}

export function listProcesses() {
  if (process.platform === "win32") return listWindows();
  if (process.platform === "linux") return listLinux();
  return Promise.reject(new Error(`This system (${process.platform}) is not supported. Windows and Linux are.`));
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) return fail(args.error);
  if (process.platform !== "win32" && process.platform !== "linux") {
    return fail(`This system (${process.platform}) is not supported. Windows and Linux are.`);
  }
  const samples = [];
  let executable = "";
  try {
    for (let i = 0; i < args.samples; i++) {
      if (i > 0) await sleep(args.every);
      const rows = buildTree(await listProcesses());
      if (!rows.length) return fail("Peika is not running. Start it, put it in the state to measure, and run this again.");
      if (!executable) executable = rows.find((row) => row.role === "peika")?.path || "";
      samples.push(rows);
    }
  } catch (err) {
    return fail(`I could not read the process list: ${err.message}`);
  }
  const { rows, totals } = summarize(samples);
  const result = { label: args.label, time: new Date().toISOString(), build: buildKind(executable), executable, samples: samples.length, rows, totals };
  console.log(args.json ? JSON.stringify(toReport(result), null, 2) : formatTable(result));
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

// Only when run as a script, so a test can import the functions above.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
