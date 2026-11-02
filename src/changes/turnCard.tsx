import { useSyncExternalStore } from "react";

import { mountViewCard, runCommand, ViewFilterCard } from "../panel/filterCard.tsx";
import { type ProjectIconSource, projectIconUri, useProjectIcons } from "../threads/projectIcon.ts";

/** What the turn's card shows: the turn's number, and the thread it is of. */
export interface TurnCardState {
  readonly turnCount: number;
  readonly threadTitle: string;
  readonly project: ProjectIconSource;
}

let state: TurnCardState | undefined;
const listeners = new Set<() => void>();

const turnCard = {
  get: () => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** The turn the changes view shows, or none: the card hides. */
export function setTurnCard(next: TurnCardState | undefined): void {
  if (JSON.stringify(next) === JSON.stringify(state)) return;
  state = next;
  for (const listener of listeners) listener();
}

/**
 * Source Control's filter while the changes view shows a turn, as the
 * Explorer tab's is: the project's icon, its name and the turn's number
 * ("pult / Turn 5"), then the thread's title; its clear mark is "Pult:
 * Close Turn Changes".
 */
function TurnCard() {
  const turn = useSyncExternalStore(turnCard.subscribe, turnCard.get);
  useProjectIcons();
  if (turn === undefined) return null;
  return (
    <ViewFilterCard
      icon={<img className="pult-card-icon" src={projectIconUri(turn.project).toString(true)} alt="" />}
      top={`${turn.project.name} / Turn ${turn.turnCount}`}
      title={turn.threadTitle}
      tooltip={`Only turn ${turn.turnCount}'s changes`}
      clearTitle="Clear the filter: show the project's changes"
      onClear={() => runCommand("pult-shell.closeTurnChanges")}
    />
  );
}

/** The turn's card above Source Control's tree. */
export function mountTurnCard(): Promise<void> {
  return mountViewCard("workbench.scm", ".part.sidebar .scm-view", <TurnCard />);
}
