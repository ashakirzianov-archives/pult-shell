// The thread's branch, as an entry of Pult's composer bar: upstream's branch
// picker on the thread, its trigger the branch icon alone (`shell.css`).
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import {
  BranchToolbarBranchSelector,
  type BranchToolbarBranchSelectorHandle,
} from "../t3/src/components/BranchToolbarBranchSelector";
import { ComposerControlsSlotItem } from "../t3/src/components/chat/ComposerFooterControls";
import { useQuietThreadShell } from "../t3/src/state/entities";

/** How long the pointer rests on the icon before the picker opens, as a click opens it. */
const HOVER_OPEN_DELAY_MS = 500;

/**
 * The branch, while the server records one: an icon that opens upstream's
 * branch picker on a click or a resting pointer, the picker switching the
 * thread's checkout as upstream's does. Once open, it stays open until it is
 * dismissed, as a picker with a search field should.
 */
export function ThreadBranchEntry({
  environmentId,
  threadId,
}: {
  readonly environmentId: string;
  readonly threadId: string;
}) {
  const ref = scopeThreadRef(EnvironmentId.make(environmentId), ThreadId.make(threadId));
  const branch = useQuietThreadShell(ref)?.branch ?? null;
  const picker = useRef<BranchToolbarBranchSelectorHandle>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cancel = () => clearTimeout(timer.current);
  useEffect(() => cancel, []);
  if (branch === null) return null;
  return (
    <ComposerControlsSlotItem item="branch">
      <span
        className="pult-bar-branch"
        onPointerEnter={() => {
          cancel();
          timer.current = setTimeout(() => picker.current?.open(), HOVER_OPEN_DELAY_MS);
        }}
        onPointerLeave={cancel}
        onPointerDown={cancel}
      >
        <BranchToolbarBranchSelector
          ref={picker}
          environmentId={ref.environmentId}
          threadId={ref.threadId}
          // A server thread's checkout is its own: upstream picks a worktree's base only for a draft.
          envLocked
          startFromOrigin={false}
          onStartFromOriginChange={() => {}}
        />
      </span>
    </ComposerControlsSlotItem>
  );
}
