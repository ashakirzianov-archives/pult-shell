import type { ProjectDraft } from "../../thread-view/shell/drafts.ts";

export type { ProjectDraft };

type Source = typeof import("../../thread-view/shell/drafts.ts");

let source: Promise<Source> | undefined;

/**
 * One of the thread view's composer lists (`thread-view/shell/drafts.ts`) for
 * `useSyncExternalStore`, loaded on the first subscriber without the rest
 * of the view, and `initial` until then.
 */
function lazyList<T>(initial: T, pick: (module: Source) => { get(): T; subscribe(listener: () => void): () => void }) {
  let value = initial;
  const listeners = new Set<() => void>();
  let loading: Promise<void> | undefined;
  return {
    get: () => value,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      loading ??= (source ??= import("../../thread-view/shell/drafts.ts")).then((module) => {
        const list = pick(module);
        const update = () => {
          value = list.get();
          for (const each of listeners) each();
        };
        list.subscribe(update);
        update();
      });
      return () => listeners.delete(listener);
    },
  };
}

/** The projects' unsent drafts, for Ready's draft cards. */
export const projectDrafts = lazyList<ReadonlyArray<ProjectDraft>>([], (module) => module.projectDrafts);

/** The threads whose composer holds an unsent message, by the panel's `keyOf`, for their cards' mark. */
export const threadsWithUnsentMessages = lazyList<ReadonlySet<string>>(new Set(), (module) => module.threadsWithUnsentMessages);
