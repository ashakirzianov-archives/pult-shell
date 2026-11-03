// The Stars as the page knows them, apart from the workbench so
// `node --test src/stars/stars.test.ts` can run it: the folders read on each
// environment merged by their record's id into Stars, each with its homes,
// its current conversation and its state; and when the page creates or
// adopts one.
import type { ShellProject, ShellThread } from "../threads/store.ts";
import type { StarRecord } from "./record.ts";

/** A Star's folder on an environment, as the page read it. */
export interface StarFolder {
  readonly environmentId: string;
  /** Its host path. */
  readonly root: string;
  readonly record: StarRecord;
  /** How many transcripts its `conversations/<environmentId>/` holds, that of its own environment. */
  readonly conversations: number;
}

/** A Star's folder on one environment, and its project there, null until the page adopts it. */
export interface StarHome {
  readonly environmentId: string;
  readonly root: string;
  readonly projectId: string | null;
  readonly conversations: number;
}

/** What a Star reads of a thread of its projects. */
export type StarThread = Pick<
  ShellThread,
  "environmentId" | "id" | "projectId" | "parentId" | "settled" | "createdAt" | "working" | "workingSince" | "ageFrom"
>;

/** Asleep while it has no current conversation, Working while that conversation's run is on, else Awake. */
export type StarState = "asleep" | "awake" | "working";

/**
 * A Star: a record id with its homes, one per folder carrying it, on any of
 * the environments; its current conversation, the newest open root thread of
 * its projects across the homes, by creation; and its latest, open or asleep.
 */
export interface Star<Thread extends StarThread = ShellThread> {
  readonly id: string;
  readonly name: string;
  readonly tint: string;
  readonly created: string;
  readonly homes: ReadonlyArray<StarHome>;
  readonly current: Thread | null;
  readonly latest: Thread | null;
  readonly state: StarState;
}

/** How the UI names a Star: its name, or "Star" while it has none. */
export function starName(star: Pick<Star<StarThread>, "name">): string {
  return star.name.trim() === "" ? "Star" : star.name;
}

const trimSlash = (path: string) => (path.length > 1 && /[/\\]$/.test(path) ? path.slice(0, -1) : path);

/** The project of `environmentId` rooted at `root`, if there is one. */
export function projectAt(projects: ReadonlyArray<Pick<ShellProject, "environmentId" | "id" | "root">>, environmentId: string, root: string) {
  return projects.find((project) => project.environmentId === environmentId && project.root !== null && trimSlash(project.root) === trimSlash(root));
}

const newestFirst = <Thread extends StarThread>(threads: ReadonlyArray<Thread>) =>
  threads.toSorted((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

/**
 * The Stars of the folders read, in the order of their first folder: folders
 * carrying one id are one Star, each a home, its project found by its root.
 * Name and tint are its first home's.
 */
export function starsOf<Thread extends StarThread>(
  folders: ReadonlyArray<StarFolder>,
  projects: ReadonlyArray<Pick<ShellProject, "environmentId" | "id" | "root">>,
  threads: ReadonlyArray<Thread>,
): Star<Thread>[] {
  const byId = new Map<string, { record: StarRecord; homes: StarHome[] }>();
  for (const folder of folders) {
    const star = byId.get(folder.record.id) ?? { record: folder.record, homes: [] };
    byId.set(folder.record.id, star);
    star.homes.push({
      environmentId: folder.environmentId,
      root: folder.root,
      projectId: projectAt(projects, folder.environmentId, folder.root)?.id ?? null,
      conversations: folder.conversations,
    });
  }
  return [...byId.values()].map(({ record, homes }) => {
    const roots = newestFirst(
      threads.filter(
        (thread) =>
          thread.parentId === null &&
          homes.some((home) => home.projectId !== null && home.environmentId === thread.environmentId && home.projectId === thread.projectId),
      ),
    );
    const current = roots.find((thread) => !thread.settled) ?? null;
    return {
      id: record.id,
      name: record.name,
      tint: record.tint,
      created: record.created,
      homes,
      current,
      latest: roots[0] ?? null,
      state: current === null ? "asleep" : current.working ? "working" : "awake",
    };
  });
}

/** Since when a sleeping Star sleeps: its latest conversation's settlement, else its creation. */
export function asleepSince(star: Pick<Star<StarThread>, "latest" | "created">): string {
  return star.latest?.ageFrom ?? star.created;
}

/**
 * The home a sleeping Star wakes in, where its draft's composer mounts: the
 * home of its latest conversation's environment by default, else its first
 * home with a project; only homes of held environments, with a project.
 */
export function wakeHome(star: Pick<Star<StarThread>, "homes" | "latest">, held: (environmentId: string) => boolean): StarHome | undefined {
  const homes = star.homes.filter((home) => home.projectId !== null && held(home.environmentId));
  return homes.find((home) => home.environmentId === star.latest?.environmentId) ?? homes[0];
}

/**
 * How many earlier conversations the fold counts: the transcripts of the
 * current conversation's environment, else of the one that last ran, as
 * that environment's home holds them; 0 hides the fold.
 */
export function earlierConversations(star: Pick<Star<StarThread>, "homes" | "current" | "latest">): number {
  const environmentId = (star.current ?? star.latest)?.environmentId;
  return star.homes.find((home) => home.environmentId === environmentId)?.conversations ?? 0;
}

/** Which of the Stars a thread is the conversation of: a root thread of one of its homes' projects. */
export function findStarOfThread<Thread extends StarThread>(
  stars: ReadonlyArray<Star<Thread>>,
  thread: Pick<StarThread, "environmentId" | "projectId" | "parentId">,
): Star<Thread> | undefined {
  if (thread.parentId !== null) return undefined;
  return findStarOfProject(stars, thread.environmentId, thread.projectId);
}

/** The Star whose home `projectId` is, on `environmentId`. */
export function findStarOfProject<Thread extends StarThread>(stars: ReadonlyArray<Star<Thread>>, environmentId: string, projectId: string): Star<Thread> | undefined {
  return stars.find((star) => star.homes.some((home) => home.environmentId === environmentId && home.projectId === projectId));
}

/** The folders with a record and no project yet, on environments whose projects the page has: the page adopts each as a project. */
export function foldersToAdopt(
  folders: ReadonlyArray<StarFolder>,
  projects: ReadonlyArray<Pick<ShellProject, "environmentId" | "id" | "root">>,
  loaded: (environmentId: string) => boolean,
): StarFolder[] {
  return folders.filter((folder) => loaded(folder.environmentId) && projectAt(projects, folder.environmentId, folder.root) === undefined);
}

/** How the page stands with an environment's Stars, for the creation decision. */
export interface EnvironmentReading {
  readonly id: string;
  /** The connection's phase. */
  readonly phase: string;
  /** Whether the thread model has its projects. */
  readonly loaded: boolean;
  /** Whether its Stars' folder was read, every folder in it, is being read, or could not be, wholly or in part. */
  readonly read: "pending" | "read" | "failed";
  /** Whether the page tried to create a Star on it since it last connected. */
  readonly attempted: boolean;
}

/**
 * The environment the page creates a Star on by default, if any: only while
 * Show Star is on, the page holds no Star on any environment, every
 * environment has answered or failed, so a Star is never made beside one
 * still loading, no ready environment's folder failed to read, since it may
 * hold the Star, and no creation failed, was refused or lost a race since
 * an environment last connected (`halted`); then the first ready
 * environment in the page's order whose folder was read, not tried since it
 * last connected.
 */
export function creationTarget(input: {
  readonly enabled: boolean;
  /** Whether the page is restoring the environments saved before a reload. */
  readonly restoring: boolean;
  readonly halted: boolean;
  readonly stars: number;
  readonly environments: ReadonlyArray<EnvironmentReading>;
}): string | undefined {
  if (!input.enabled || input.restoring || input.halted || input.stars > 0) return undefined;
  const unsure = input.environments.some(
    (environment) =>
      environment.phase === "connecting" ||
      environment.phase === "reconnecting" ||
      (environment.phase === "ready" && (environment.read !== "read" || !environment.loaded)),
  );
  if (unsure) return undefined;
  return input.environments.find((environment) => environment.phase === "ready" && environment.read === "read" && !environment.attempted)?.id;
}
