import { getService, ICommandService, INotificationService } from "@codingame/monaco-vscode-api";
import Severity from "@codingame/monaco-vscode-api/vscode/vs/base/common/severity";
import { request } from "@t3tools/client-runtime/rpc";
import { CommandId, type ProjectMutation, ProjectId, WS_METHODS } from "@t3tools/contracts";

import { connection } from "../connection/index.ts";
import { type Disposable, toFilesError, type WorkspaceServer } from "../files/files.ts";
import { environmentHome, environmentServer } from "../files/server.ts";
import { type ShellThread, threadStore } from "../threads/store.ts";
import {
  CONVERSATIONS_DIRECTORY,
  DEFAULT_STAR_FOLDER,
  MEMORY_DIRECTORY,
  newRecord,
  parseRecord,
  RECORD_FILE,
  STAR_PROJECT_ICON,
  STAR_PROJECT_TITLE,
  type StarRecord,
  STARS_DIRECTORY,
  stockInstructions,
  withRecordFields,
} from "./record.ts";
import { starEnabled, starSettingKnown } from "./settings.ts";
import {
  creationTarget,
  findStarOfProject,
  findStarOfThread,
  foldersToAdopt,
  type Star,
  type StarFolder,
  starsOf,
  wakeHome,
} from "./stars.ts";

/** How long a burst of changes under the Stars' folder settles before the page reads it again. */
const REREAD_DELAY_MS = 300;

/** What the Star's tab mounts, in its environment: its current conversation, or while it sleeps its project's draft. */
export type StarTarget =
  | { readonly kind: "thread"; readonly environmentId: string; readonly threadId: string }
  | { readonly kind: "draft"; readonly environmentId: string; readonly projectId: string };

/** How the page stands with an environment's Stars' folder. */
interface Reading {
  read: "pending" | "read" | "failed";
  folders: ReadonlyArray<StarFolder>;
  /** Whether the page tried to create a Star on it, or adopted its folders, since it last connected. */
  attempted: boolean;
  readonly adopted: Set<string>;
  wasReady: boolean;
  watch: Disposable | undefined;
  /** The latest read's, so an older one that answers late is dropped. */
  generation: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** A host path joined with relative segments, as the environment's server takes it. */
function hostJoin(base: string, ...segments: ReadonlyArray<string>): string {
  return [base.replace(/[/\\]+$/, ""), ...segments].join("/");
}

const lastSegment = (path: string) => path.split(/[/\\]/).filter((segment) => segment !== "").at(-1) ?? path;

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) return String(error.message);
  return String(error);
}

/** A directory's entries, or null for one that is not there. */
async function listed(server: WorkspaceServer, cwd: string, directoryPath: string) {
  try {
    return (await server.listEntries({ cwd, directoryPath })).entries;
  } catch (error) {
    if (toFilesError(error, directoryPath).code === "FileNotFound") return null;
    throw error;
  }
}

/** A Star's `AGENTS.md`, or undefined while it has none. */
async function readRecordFile(server: WorkspaceServer, root: string) {
  const file = await server.readFile({ cwd: root, relativePath: RECORD_FILE, allowMissing: true });
  return file.exists === false ? undefined : file;
}

/** The Stars' folders under the environment's home: each folder of `~/.pult/stars` whose `AGENTS.md` carries a record. */
async function readFolders(server: WorkspaceServer, environmentId: string, home: string): Promise<ReadonlyArray<StarFolder> | null> {
  const entries = await listed(server, home, STARS_DIRECTORY);
  if (entries === null) return null;
  const folders = await Promise.all(
    entries
      .filter((entry) => entry.kind === "directory")
      .map(async (entry) => {
        const root = hostJoin(home, STARS_DIRECTORY, lastSegment(entry.path));
        const record = parseRecord((await readRecordFile(server, root))?.contents ?? "");
        if (record === undefined) return [];
        const transcripts = await listed(server, root, `${CONVERSATIONS_DIRECTORY}/${environmentId}`).catch(() => null);
        const conversations = transcripts?.filter((transcript) => transcript.kind === "file").length ?? 0;
        return [{ environmentId, root, record, conversations }];
      }),
  );
  return folders.flat();
}

/**
 * The page's Stars (xaxis `pult/issues/star-home`): on each held environment
 * the folders of `~/.pult/stars` whose `AGENTS.md` front matter carries a
 * Star's record, read on each connect, after the page's own writes and as
 * the folder changes (`projects.watchEntries`, as the explorer watches),
 * merged by their record's id into Stars over the thread model's projects
 * and threads (`stars.ts`). While Show Star is on and the page holds no Star
 * once every environment has answered, it creates one on the first ready
 * environment (`creationTarget`); a folder with a record and no project is
 * adopted as a project.
 */
class StarsModel {
  /** By environment id, as the connection holds them. */
  private readonly readings = new Map<string, Reading>();
  private stars: ReadonlyArray<Star> = [];
  private signature = "";
  private readonly listeners = new Set<() => void>();
  private creating = false;

  start(): void {
    connection.onDidChange(() => this.followEnvironments());
    threadStore.subscribe(() => this.update());
    starEnabled.subscribe(() => this.update());
    this.followEnvironments();
  }

  get(): ReadonlyArray<Star> {
    return this.stars;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Whether the environment's Stars' folder was read and holds no Star: a Star may be created on it by hand. */
  canCreateOn(environmentId: string): boolean {
    const reading = this.readings.get(environmentId);
    return reading?.read === "read" && reading.folders.length === 0 && connection.environment(environmentId)?.phase === "ready";
  }

  /** Follows every environment the connection holds and no other, reading each one's Stars as it becomes ready. */
  private followEnvironments(): void {
    const environments = connection.environments;
    for (const [environmentId, reading] of this.readings) {
      if (environments.some((environment) => environment.environmentId === environmentId)) continue;
      reading.watch?.dispose();
      clearTimeout(reading.timer);
      this.readings.delete(environmentId);
    }
    for (const environment of environments) {
      let reading = this.readings.get(environment.environmentId);
      if (reading === undefined) {
        reading = { read: "pending", folders: [], attempted: false, adopted: new Set(), wasReady: false, watch: undefined, generation: 0, timer: undefined };
        this.readings.set(environment.environmentId, reading);
      }
      const ready = environment.phase === "ready";
      if (ready && !reading.wasReady) {
        // A failed creation or adoption is tried again on the next connect.
        reading.attempted = false;
        reading.adopted.clear();
        void this.read(environment.environmentId);
      }
      reading.wasReady = ready;
    }
    this.update();
  }

  /** Reads the environment's Stars' folder again, and watches it once it is there. */
  async read(environmentId: string): Promise<void> {
    const reading = this.readings.get(environmentId);
    if (reading === undefined) return;
    const generation = ++reading.generation;
    try {
      const home = await environmentHome(environmentId);
      const server = environmentServer(environmentId);
      const folders = await readFolders(server, environmentId, home);
      if (reading.generation !== generation || this.readings.get(environmentId) !== reading) return;
      reading.read = "read";
      reading.folders = folders ?? [];
      if (folders !== null) await this.watch(environmentId, reading, server, hostJoin(home, STARS_DIRECTORY));
    } catch (error) {
      if (reading.generation !== generation) return;
      console.warn(`[pult-shell] could not read the Stars of ${environmentId}: ${errorMessage(error)}`);
      reading.read = "failed";
    }
    this.update();
  }

  /** Watches the Stars' folder, where the server can, reading it again a moment after each burst of changes. */
  private async watch(environmentId: string, reading: Reading, server: WorkspaceServer, directory: string): Promise<void> {
    if (reading.watch !== undefined || !(await server.features()).watchEntries) return;
    const reread = () => {
      clearTimeout(reading.timer);
      reading.timer = setTimeout(() => void this.read(environmentId), REREAD_DELAY_MS);
    };
    reading.watch = server.watchEntries(directory, {
      subscribed: async () => {},
      changed: reread,
      gone: () => {
        reading.watch = undefined;
        reread();
      },
    });
  }

  /** Merges the folders into Stars over the store's projects and threads, tells the listeners when they changed, then creates or adopts as due. */
  private update(): void {
    const { projects, threads } = threadStore.get();
    const folders = [...this.readings.values()].flatMap((reading) => reading.folders);
    const stars = starsOf(folders, projects, threads);
    // The readings too, which tell where a Star may be created.
    const signature = JSON.stringify([
      stars.map((star) => [star.id, star.name, star.tint, star.homes, star.state, star.current?.id, star.current?.workingSince, star.latest?.id, star.latest?.ageFrom]),
      [...this.readings.values()].map((reading) => reading.read),
    ]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.stars = stars;
      for (const listener of this.listeners) listener();
    }
    this.adopt(folders);
    const target = creationTarget({
      enabled: starSettingKnown() && starEnabled.get(),
      restoring: connection.connecting,
      stars: new Set(folders.map((folder) => folder.record.id)).size,
      environments: connection.environments.map((environment) => {
        const reading = this.readings.get(environment.environmentId);
        return {
          id: environment.environmentId,
          phase: environment.phase,
          loaded: threadStore.environment(environment.environmentId)?.loaded === true,
          read: reading?.read ?? "pending",
          attempted: reading?.attempted ?? false,
        };
      }),
    });
    if (target !== undefined && !this.creating) void this.create(target);
  }

  /** Makes each folder with a record and no project a project, once per connect: the folder of a Star made elsewhere, or by a creation cut short. */
  private adopt(folders: ReadonlyArray<StarFolder>): void {
    const loaded = (environmentId: string) => threadStore.environment(environmentId)?.loaded === true;
    for (const folder of foldersToAdopt(folders, threadStore.get().projects, loaded)) {
      const reading = this.readings.get(folder.environmentId);
      if (reading === undefined || reading.adopted.has(folder.root)) continue;
      reading.adopted.add(folder.root);
      void this.createProject(folder.environmentId, folder.root).then(
        (projectId) => setStarIcon(folder.environmentId, projectId).then(() => this.read(folder.environmentId)),
        (error: unknown) => console.warn(`[pult-shell] could not adopt the Star at ${folder.root}: ${errorMessage(error)}`),
      );
    }
  }

  /**
   * Creates a Star on the environment, `~/.pult/stars/star`: the project,
   * titled Star, which makes the folder, then the folder's `memory/` and
   * `conversations/` and its `AGENTS.md`, the record and the stock
   * instructions, then the project's 🌟. A folder there that is a Star
   * already is read, one whose project another page has just made is left
   * to that page, and anything else there is refused. One notification
   * says the Star is ready; a failure notifies, and is tried again on the
   * next connect.
   */
  async create(environmentId: string): Promise<void> {
    const reading = this.readings.get(environmentId);
    if (reading === undefined || this.creating) return;
    reading.attempted = true;
    this.creating = true;
    const notifications = await getService(INotificationService);
    try {
      const home = await environmentHome(environmentId);
      const server = environmentServer(environmentId);
      const root = hostJoin(home, STARS_DIRECTORY, DEFAULT_STAR_FOLDER);
      const shown = `~/${STARS_DIRECTORY}/${DEFAULT_STAR_FOLDER}`;
      const project = threadStore.get().projects.find((candidate) => candidate.environmentId === environmentId && candidate.root === root);
      const entries = await listed(server, home, `${STARS_DIRECTORY}/${DEFAULT_STAR_FOLDER}`);
      if (entries !== null) {
        const file = await readRecordFile(server, root);
        if (file !== undefined && parseRecord(file.contents) !== undefined) return;
        // A folder of the page's own making, its project there and nothing in it but its folders, is finished; anything else is someone's.
        const ours = project !== undefined && entries.every((entry) => [MEMORY_DIRECTORY, CONVERSATIONS_DIRECTORY].includes(lastSegment(entry.path)));
        if (!ours) {
          notifications.error(`Pult did not create your Star: ${shown} exists and is not a Star.`);
          return;
        }
      }
      let projectId = project?.id;
      if (projectId === undefined) {
        try {
          projectId = await this.createProject(environmentId, root);
        } catch (error) {
          // Another page got there first: its Star shows as it writes the folder.
          if (/already belongs to project/i.test(errorMessage(error))) return;
          throw error;
        }
      }
      const record = newRecord(crypto.randomUUID(), new Date().toISOString());
      await server.createDirectory({ cwd: root, relativePath: MEMORY_DIRECTORY });
      await server.createDirectory({ cwd: root, relativePath: CONVERSATIONS_DIRECTORY });
      await server.writeFile({ cwd: root, relativePath: RECORD_FILE, contents: stockInstructions(record) });
      await setStarIcon(environmentId, projectId);
      notifications.prompt(Severity.Info, "Your Star is ready.", [{ label: "Open Star", run: () => void openStar(record.id) }]);
    } catch (error) {
      notifications.error(`Pult could not create your Star: ${errorMessage(error)}`);
    } finally {
      this.creating = false;
      await this.read(environmentId);
    }
  }

  /** A project titled Star at `root`, which the server makes when it is missing; its id. */
  private async createProject(environmentId: string, root: string): Promise<string> {
    const project = await mutate(environmentId, {
      type: "project.create",
      commandId: newCommandId(),
      projectId: ProjectId.make(crypto.randomUUID()),
      title: STAR_PROJECT_TITLE,
      workspaceRoot: root,
      createWorkspaceRootIfMissing: true,
      defaultModelSelection: null,
    });
    return project.id;
  }

  /**
   * Writes the record's `changes` into every home of the Star the page
   * holds, a read-modify-write of `AGENTS.md`'s front matter alone, over the
   * version read where the server tells versions; a failure notifies.
   */
  async setFields(starId: string, changes: Partial<Pick<StarRecord, "name" | "tint">>): Promise<void> {
    const star = this.stars.find((candidate) => candidate.id === starId);
    if (star === undefined) return;
    const notifications = await getService(INotificationService);
    await Promise.all(
      star.homes
        .filter((home) => connection.environment(home.environmentId) !== undefined)
        .map(async (home) => {
          try {
            const server = environmentServer(home.environmentId);
            const file = await readRecordFile(server, home.root);
            if (file === undefined || parseRecord(file.contents)?.id !== starId) return;
            await server.writeFile({
              cwd: home.root,
              relativePath: RECORD_FILE,
              contents: withRecordFields(file.contents, changes),
              ...(file.version === undefined ? {} : { expectedVersion: file.version }),
            });
          } catch (error) {
            notifications.error(`Pult could not change your Star: ${errorMessage(error)}`);
          } finally {
            await this.read(home.environmentId);
          }
        }),
    );
  }
}

function newCommandId() {
  return CommandId.make(crypto.randomUUID());
}

function mutate(environmentId: string, mutation: ProjectMutation) {
  return connection.run(environmentId, request(WS_METHODS.projectsMutate, mutation));
}

/** The 🌟 upstream's UI shows for the Star's project. */
function setStarIcon(environmentId: string, projectId: string) {
  return mutate(environmentId, { type: "project.update", commandId: newCommandId(), projectId: ProjectId.make(projectId), projectIcon: STAR_PROJECT_ICON });
}

/** Selects the Star, through its command, which `selection.ts` registers. */
async function openStar(starId: string): Promise<void> {
  await (await getService(ICommandService)).executeCommand("pult-shell.selectStar", starId);
}

const model = new StarsModel();

/** Starts the Stars' model on the page's connection and thread model; before the workbench, as they are. */
export function startStars(): void {
  model.start();
}

/** The page's Stars, for `useSyncExternalStore`: the same array until a Star changes. */
export const starStore = {
  get: () => model.get(),
  subscribe: (listener: () => void) => model.subscribe(listener),
};

export function starById(starId: string): Star | undefined {
  return model.get().find((star) => star.id === starId);
}

export const createStar = (environmentId: string) => model.create(environmentId);
export const canCreateStarOn = (environmentId: string) => model.canCreateOn(environmentId);
export const setStarFields = (starId: string, changes: Partial<Pick<StarRecord, "name" | "tint">>) => model.setFields(starId, changes);

/** Whether the page holds the environment. */
const held = (environmentId: string) => connection.environment(environmentId) !== undefined;

/**
 * What the Star's tab shows: its current conversation, or while it sleeps
 * its project's draft in the home it wakes in (`wakeHome`); undefined while
 * none of its homes has a project on a held environment.
 */
export function starTarget(star: Star): StarTarget | undefined {
  if (star.current !== null) return { kind: "thread", environmentId: star.current.environmentId, threadId: star.current.id };
  const home = wakeHome(star, held);
  return home?.projectId == null ? undefined : { kind: "draft", environmentId: home.environmentId, projectId: home.projectId };
}

/** The home whose folder stands for the Star, its instructions and its folder: its current conversation's or wake's, else its first held one. */
export function primaryHome(star: Star) {
  const target = starTarget(star);
  return star.homes.find((home) => home.environmentId === target?.environmentId && held(home.environmentId)) ?? star.homes.find((home) => held(home.environmentId));
}

/** The Star a thread is the conversation of: a root thread of one of its homes' projects, in any state. */
export function starOfThread(thread: Pick<ShellThread, "environmentId" | "projectId" | "parentId">): Star | undefined {
  return findStarOfThread(model.get(), thread);
}

/** The Star whose home `projectId` is. */
export function starOfProject(environmentId: string, projectId: string): Star | undefined {
  return findStarOfProject(model.get(), environmentId, projectId);
}
