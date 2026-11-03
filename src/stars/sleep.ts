// When a Star falls asleep (xaxis `pult/issues/star-sleep`, the rule of
// `pult/issues/durable-agent-sleep`), apart from the workbench so
// `node --test src/stars/sleep.test.ts` can run it. The page evaluates it on
// a conversation's projection whenever it looks (`conversations.ts`), so a
// deadline that passed while no page was open puts the Star to sleep as soon
// as one sees it.
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/** How long a conversation stays awake after its last turn where the adapter observed no prompt cache TTL. */
export const DEFAULT_CACHE_TTL_MS = 10 * 60_000;

/**
 * Whether a conversation may fall asleep: held awake while a run is on, a
 * message is queued, held or not, or a runtime request (an approval, a
 * question) awaits the user; else asleep from `at`, in epoch milliseconds.
 */
export type Wakefulness =
  | { readonly kind: "held"; readonly by: "run" | "queued" | "request" }
  | { readonly kind: "deadline"; readonly at: number };

export type SleepInput = Pick<OrchestrationV2ThreadProjection, "thread" | "runs" | "providerTurns" | "runtimeRequests">;

const LIVE_RUNS: ReadonlySet<string> = new Set(["preparing", "starting", "running", "waiting"]);
const LIVE_TURNS: ReadonlySet<string> = new Set(["pending", "running"]);

/**
 * The rule: a conversation falls asleep at its last provider turn's
 * `completedAt` plus the prompt cache TTL the adapter observed for it
 * (`promptCacheTtlMs` on the turn's token usage, else on the latest earlier
 * turn of the same provider thread that reported one, since a request served
 * wholly from the cache reports none while refreshing it), 10 minutes where
 * none was observed. Without a completed provider turn, its latest finished
 * run stands in, else its creation.
 */
export function wakefulness(projection: SleepInput): Wakefulness {
  if (projection.runs.some((run) => LIVE_RUNS.has(run.status)) || projection.providerTurns.some((turn) => LIVE_TURNS.has(turn.status))) {
    return { kind: "held", by: "run" };
  }
  if (projection.runs.some((run) => run.status === "queued")) return { kind: "held", by: "queued" };
  if (projection.runtimeRequests.some((request) => request.status === "pending")) return { kind: "held", by: "request" };
  const turns = projection.providerTurns
    .flatMap((turn) => (turn.completedAt === null ? [] : [{ turn, completedAt: DateTime.toEpochMillis(turn.completedAt) }]))
    .toSorted((left, right) => left.completedAt - right.completedAt);
  const last = turns.at(-1);
  if (last === undefined) {
    const finished = projection.runs.flatMap((run) => (run.completedAt === null ? [] : [DateTime.toEpochMillis(run.completedAt)]));
    const base = finished.length > 0 ? Math.max(...finished) : DateTime.toEpochMillis(projection.thread.createdAt);
    return { kind: "deadline", at: base + DEFAULT_CACHE_TTL_MS };
  }
  const observed = turns.findLast(({ turn }) => turn.providerThreadId === last.turn.providerThreadId && turn.tokenUsage?.promptCacheTtlMs !== undefined);
  return { kind: "deadline", at: last.completedAt + (observed?.turn.tokenUsage?.promptCacheTtlMs ?? DEFAULT_CACHE_TTL_MS) };
}

/** Whether a conversation with this wakefulness is asleep by `now`. */
export function asleepBy(state: Wakefulness, now: number): boolean {
  return state.kind === "deadline" && now >= state.at;
}
