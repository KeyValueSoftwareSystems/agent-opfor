/**
 * Session id primitives in targets/httpClient.ts: client- vs server-owned
 * resolution (including legacy `sessionIdField`/`sessionField` aliases),
 * request injection into body/header, and capture from body / header / Set-Cookie.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSessionPlan,
  applySessionToRequest,
  captureSessionFromResponse,
  getByPath,
} from "../src/targets/httpClient.js";

test("resolveSessionPlan: legacy sessionIdField folds to client-owned body send", () => {
  const plan = resolveSessionPlan({ sessionIdField: "sessionId" });
  assert.equal(plan.mode, "client");
  assert.deepEqual(plan.send, { in: "body", name: "sessionId" });
  assert.equal(plan.receive, undefined);
});

test("resolveSessionPlan: legacy autonomous sessionField also folds to body send", () => {
  const plan = resolveSessionPlan({ sessionField: "thread_id", mode: "stateful" });
  assert.equal(plan.mode, "client");
  assert.deepEqual(plan.send, { in: "body", name: "thread_id" });
});

test("resolveSessionPlan: explicit session.send wins over legacy sugar", () => {
  const plan = resolveSessionPlan({
    sessionIdField: "ignored",
    session: { send: { in: "header", name: "X-Session-Id" } },
  });
  assert.equal(plan.mode, "client");
  assert.deepEqual(plan.send, { in: "header", name: "X-Session-Id" });
});

test("resolveSessionPlan: receive configured => server-owned mode", () => {
  const plan = resolveSessionPlan({
    session: {
      send: { in: "header", name: "Mcp-Session-Id" },
      receive: { in: "header", name: "Mcp-Session-Id" },
    },
  });
  assert.equal(plan.mode, "server");
  assert.deepEqual(plan.receive, { in: "header", name: "Mcp-Session-Id" });
});

test("resolveSessionPlan: stateless targets carry no session", () => {
  assert.equal(resolveSessionPlan({ stateful: false, sessionIdField: "x" }).mode, "none");
  assert.equal(resolveSessionPlan({ mode: "stateless", sessionField: "x" }).mode, "none");
});

test("resolveSessionPlan: nothing configured => none", () => {
  assert.equal(resolveSessionPlan({}).mode, "none");
});

test("applySessionToRequest: body dot-path and header injection", () => {
  const bodyPlan = resolveSessionPlan({ session: { send: { in: "body", name: "meta.session" } } });
  const body: Record<string, unknown> = {};
  const headers: Record<string, string> = {};
  applySessionToRequest(body, headers, bodyPlan, "abc");
  assert.equal(getByPath(body, "meta.session"), "abc");
  assert.deepEqual(headers, {});

  const headerPlan = resolveSessionPlan({ session: { send: { in: "header", name: "X-Sid" } } });
  const body2: Record<string, unknown> = {};
  const headers2: Record<string, string> = { "X-Sid": "static" };
  applySessionToRequest(body2, headers2, headerPlan, "dynamic");
  assert.equal(headers2["X-Sid"], "dynamic"); // dynamic value wins over static
  assert.deepEqual(body2, {});
});

test("applySessionToRequest: no-op without an id or a send plan", () => {
  const body: Record<string, unknown> = {};
  const headers: Record<string, string> = {};
  applySessionToRequest(body, headers, resolveSessionPlan({}), "abc");
  assert.deepEqual(body, {});
  applySessionToRequest(
    body,
    headers,
    resolveSessionPlan({ session: { send: { in: "body", name: "s" } } }),
    undefined
  );
  assert.deepEqual(body, {});
});

test("captureSessionFromResponse: body dot-path", () => {
  const plan = resolveSessionPlan({
    session: { send: { in: "body", name: "s" }, receive: { in: "body", name: "data.sid" } },
  });
  const captured = captureSessionFromResponse(
    JSON.stringify({ data: { sid: "sess-42" } }),
    new Headers(),
    plan
  );
  assert.equal(captured, "sess-42");
});

test("captureSessionFromResponse: header", () => {
  const plan = resolveSessionPlan({
    session: {
      send: { in: "header", name: "Mcp-Session-Id" },
      receive: { in: "header", name: "Mcp-Session-Id" },
    },
  });
  const headers = new Headers({ "Mcp-Session-Id": "mcp-9" });
  assert.equal(captureSessionFromResponse("{}", headers, plan), "mcp-9");
});

test("captureSessionFromResponse: Set-Cookie by name and first-cookie fallback", () => {
  const named = resolveSessionPlan({
    session: {
      send: { in: "header", name: "Cookie" },
      receive: { in: "set-cookie", name: "sid" },
    },
  });
  const headers = new Headers();
  headers.append("Set-Cookie", "other=1; Path=/");
  headers.append("Set-Cookie", "sid=xyz; Path=/; HttpOnly");
  assert.equal(captureSessionFromResponse("{}", headers, named), "sid=xyz");

  const firstCookie = resolveSessionPlan({
    session: { send: { in: "header", name: "Cookie" }, receive: { in: "set-cookie" } },
  });
  const h2 = new Headers({ "Set-Cookie": "first=aaa; Path=/" });
  assert.equal(captureSessionFromResponse("{}", h2, firstCookie), "first=aaa");
});

test("captureSessionFromResponse: no receive plan => undefined", () => {
  const plan = resolveSessionPlan({ session: { send: { in: "body", name: "s" } } });
  assert.equal(captureSessionFromResponse('{"sid":"x"}', new Headers(), plan), undefined);
});
