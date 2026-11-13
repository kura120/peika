// The contract a theme is built against (src/contract/): its stand-in, and
// the promises the folder makes. Nothing of the app runs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CONTRACT_VERSION, createStandIn } from "../src/contract/index.ts";

const FOLDER = fileURLToPath(new URL("../src/contract/", import.meta.url));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("the version is 1, on the constant and on the stand-in", () => {
  assert.equal(CONTRACT_VERSION, 1);
  assert.equal(createStandIn().version, 1);
});

test("the first snapshot has three sessions, one that needs the user, one request and no answer", () => {
  const snapshot = createStandIn().snapshot();
  assert.equal(snapshot.sessions.length, 3);
  assert.equal(snapshot.sessions.filter((row) => row.state === "needs-you").length, 1);
  assert.equal(snapshot.requests.length, 1);
  assert.notEqual(snapshot.requests[0].summary, "");
  assert.equal(snapshot.answer, null);
});

test("words sent to Peika are accepted and an answer follows", async () => {
  const host = createStandIn();
  const heard = [];
  host.subscribe((change) => heard.push(change));
  assert.deepEqual(await host.ask({ type: "send-words", text: "hello", to: { kind: "peika" } }), { ok: true });
  await wait(700);
  const answer = heard.find((change) => change.answer)?.answer;
  assert.ok(answer && answer.text.length > 0);
  assert.equal(host.snapshot().answer?.text, answer.text);
});

test("words sent to an unknown session are refused with a reason, and nothing throws", async () => {
  const result = await createStandIn().ask({ type: "send-words", text: "hello", to: { kind: "session", id: "nope" } });
  assert.equal(result.ok, false);
  assert.ok(result.reason.length > 0);
});

test("only the stand-in's controls resolve a request; no ask does", async () => {
  const host = createStandIn();
  const heard = [];
  host.subscribe((change) => heard.push(change));
  const id = host.snapshot().requests[0].id;
  const result = await host.ask({ type: "answer-request", id, allow: true });
  assert.equal(result.ok, false);
  assert.equal(host.snapshot().requests.length, 1);
  assert.equal(heard.length, 0);
  host.controls.resolveRequest(id);
  assert.equal(host.snapshot().requests.length, 0);
  assert.equal(heard.length, 1);
  assert.deepEqual(heard[0].requests, []);
});

test("a permission or a driver waits for a click and changes nothing", async () => {
  const host = createStandIn();
  const before = host.snapshot();
  const modelId = before.models[0].id;
  assert.deepEqual(await host.ask({ type: "set-permission", modelId, group: "see-screen", level: "allow" }), { ok: true, waitingForClick: true });
  assert.deepEqual(await host.ask({ type: "set-driver", id: before.drivers[2].id, on: true }), { ok: true, waitingForClick: true });
  assert.equal(host.snapshot(), before);
});

test("the function subscribe returns stops further notices", () => {
  const host = createStandIn();
  let told = 0;
  const stop = host.subscribe(() => told++);
  host.controls.setSessionState("s-web", "done");
  assert.equal(told, 1);
  stop();
  host.controls.setSessionState("s-web", "idle");
  assert.equal(told, 1);
});

test("a snapshot cannot be written to", () => {
  "use strict";
  const host = createStandIn();
  const snapshot = host.snapshot();
  assert.throws(() => { snapshot.sessions[0].title = "x"; }, TypeError);
  assert.throws(() => { snapshot.sessions.push({}); }, TypeError);
  assert.throws(() => { snapshot.sessions[0].agent.name = "x"; }, TypeError);
  host.controls.addSession({ id: "s-new", title: "new", agent: { id: "a", name: "A", color: "#000000" }, state: "idle" });
  assert.throws(() => { host.snapshot().sessions[3].title = "x"; }, TypeError);
});

test("no file of the folder imports anything outside it", () => {
  const files = readdirSync(FOLDER).filter((name) => name.endsWith(".ts"));
  assert.ok(files.length >= 6);
  for (const file of files) {
    const source = readFileSync(FOLDER + file, "utf8");
    for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
      assert.ok(match[1].startsWith("./"), `${file} imports ${match[1]}`);
    }
    assert.ok(!/\bimport\s*\(/.test(source) && !/\bimport\s+["']/.test(source), `${file} imports in another way`);
  }
});

test("no sample text uses a word the user must never see", () => {
  const snapshot = createStandIn().snapshot();
  const strings = [];
  const walk = (value) => {
    if (typeof value === "string") strings.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(snapshot);
  assert.ok(strings.length > 20);
  for (const text of strings) assert.ok(!/kernel|shell|capabilit|manifest|hook|mcp|pipe/i.test(text), text);
});
