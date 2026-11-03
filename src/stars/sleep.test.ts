// Run with `node --test src/stars/sleep.test.ts`.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MessageId,
  NodeId,
  type OrchestrationV2ProviderTurn,
  type OrchestrationV2Run,
  type OrchestrationV2RuntimeRequest,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  RuntimeRequestId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { v2Projection } from "../../vendor/t3code/packages/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import { asleepBy, DEFAULT_CACHE_TTL_MS, type SleepInput, wakefulness } from "./sleep.ts";

const at = (iso: string) => DateTime.makeUnsafe(iso);
const ms = (iso: string) => Date.parse(iso);

function run(id: string, status: OrchestrationV2Run["status"], completedAt: string | null = null): OrchestrationV2Run {
  return {
    id: RunId.make(id),
    threadId: v2Projection.thread.id,
    ordinal: 1,
    providerInstanceId: ProviderInstanceId.make("claude"),
    modelSelection: v2Projection.thread.modelSelection,
    providerThreadId: null,
    userMessageId: MessageId.make(`message-${id}`),
    rootNodeId: null,
    activeAttemptId: null,
    status,
    requestedAt: at("2026-11-03T10:00:00.000Z"),
    startedAt: at("2026-11-03T10:00:01.000Z"),
    completedAt: completedAt === null ? null : at(completedAt),
    checkpointId: null,
    contextHandoffId: null,
  };
}

function turn(id: string, completedAt: string | null, options: { status?: OrchestrationV2ProviderTurn["status"]; ttl?: number; providerThread?: string } = {}): OrchestrationV2ProviderTurn {
  return {
    id: ProviderTurnId.make(id),
    providerThreadId: ProviderThreadId.make(options.providerThread ?? "provider-thread"),
    nodeId: NodeId.make(`node-${id}`),
    runAttemptId: null,
    nativeTurnRef: null,
    ordinal: 1,
    status: options.status ?? (completedAt === null ? "running" : "completed"),
    startedAt: at("2026-11-03T10:00:00.000Z"),
    completedAt: completedAt === null ? null : at(completedAt),
    ...(options.ttl === undefined
      ? {}
      : { tokenUsage: { usedTokens: 1000, promptCacheTtlMs: options.ttl, updatedAt: completedAt ?? "2026-11-03T10:00:00.000Z" } }),
  };
}

function request(status: OrchestrationV2RuntimeRequest["status"]): OrchestrationV2RuntimeRequest {
  return {
    id: RuntimeRequestId.make("request"),
    nodeId: NodeId.make("node-request"),
    providerTurnId: null,
    nativeRequestRef: null,
    kind: "command",
    status,
    responseCapability: { type: "message" },
    createdAt: at("2026-11-03T10:05:00.000Z"),
    resolvedAt: null,
  };
}

const conversation = (overrides: Partial<SleepInput>): SleepInput => ({ ...v2Projection, ...overrides });

describe("wakefulness", () => {
  test("falls asleep at the last turn's end plus the cache TTL its adapter observed", () => {
    const state = wakefulness(
      conversation({
        runs: [run("one", "completed", "2026-11-03T10:10:00.000Z")],
        providerTurns: [turn("early", "2026-11-03T10:02:00.000Z", { ttl: 3_600_000 }), turn("last", "2026-11-03T10:10:00.000Z", { ttl: 300_000 })],
      }),
    );
    assert.deepEqual(state, { kind: "deadline", at: ms("2026-11-03T10:15:00.000Z") });
  });

  test("takes the TTL observed earlier on the same provider thread when the last turn reported none", () => {
    const state = wakefulness(
      conversation({
        providerTurns: [
          turn("early", "2026-11-03T10:02:00.000Z", { ttl: 3_600_000 }),
          turn("elsewhere", "2026-11-03T10:05:00.000Z", { ttl: 300_000, providerThread: "other" }),
          turn("cached", "2026-11-03T10:10:00.000Z"),
        ],
      }),
    );
    assert.deepEqual(state, { kind: "deadline", at: ms("2026-11-03T11:10:00.000Z") });
  });

  test("allows 10 minutes where no TTL was observed, as for a Codex turn", () => {
    const state = wakefulness(conversation({ providerTurns: [turn("codex", "2026-11-03T10:10:00.000Z")] }));
    assert.deepEqual(state, { kind: "deadline", at: ms("2026-11-03T10:10:00.000Z") + DEFAULT_CACHE_TTL_MS });
  });

  test("falls back to the latest finished run, then to the thread's creation", () => {
    assert.deepEqual(wakefulness(conversation({ runs: [run("failed", "failed", "2026-11-03T10:20:00.000Z")] })), {
      kind: "deadline",
      at: ms("2026-11-03T10:20:00.000Z") + DEFAULT_CACHE_TTL_MS,
    });
    assert.deepEqual(wakefulness(conversation({})), {
      kind: "deadline",
      at: DateTime.toEpochMillis(v2Projection.thread.createdAt) + DEFAULT_CACHE_TTL_MS,
    });
  });

  test("holds the conversation awake while a run is on, a message is queued or a request awaits the user", () => {
    const done = turn("done", "2026-11-03T10:10:00.000Z");
    assert.deepEqual(wakefulness(conversation({ runs: [run("live", "running")], providerTurns: [done] })), { kind: "held", by: "run" });
    assert.deepEqual(wakefulness(conversation({ runs: [run("draining", "waiting")], providerTurns: [done] })), { kind: "held", by: "run" });
    assert.deepEqual(wakefulness(conversation({ providerTurns: [done, turn("now", null)] })), { kind: "held", by: "run" });
    assert.deepEqual(wakefulness(conversation({ runs: [run("done", "completed", "2026-11-03T10:10:00.000Z"), { ...run("next", "queued"), queueHeld: true }], providerTurns: [done] })), {
      kind: "held",
      by: "queued",
    });
    assert.deepEqual(wakefulness(conversation({ providerTurns: [done], runtimeRequests: [request("pending")] })), { kind: "held", by: "request" });
    assert.equal(wakefulness(conversation({ providerTurns: [done], runtimeRequests: [request("resolved")] })).kind, "deadline");
  });
});

describe("asleepBy", () => {
  test("is asleep from the deadline on, and never while held", () => {
    const deadline = { kind: "deadline", at: 1_000 } as const;
    assert.equal(asleepBy(deadline, 999), false);
    assert.equal(asleepBy(deadline, 1_000), true);
    assert.equal(asleepBy({ kind: "held", by: "run" }, Number.MAX_SAFE_INTEGER), false);
  });
});
