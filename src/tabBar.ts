import { MenuId, MenuRegistry, isIMenuItem, isISubmenuItem } from "@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions";
import { ContextKeyExpr, type ContextKeyExpression } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey";

import { VSCodeModeContext } from "./mode.ts";

/** The palette's ways to the tab bar's other modes: Single, None, and back to Multiple. */
const TAB_MODE_COMMANDS = new Set([
  "workbench.action.showMultipleEditorTabs",
  "workbench.action.showEditorTab",
  "workbench.action.hideEditorTabs",
]);

/**
 * Pult's mode keeps the tab bar on Multiple (`startMode`, `src/mode.ts`),
 * since a thread's tab is its header, so the stock ways to Single and None,
 * the tabs bar's Tab Bar submenu and the palette's commands, show in VS Code
 * mode alone: their registered items take `pult.vscodeMode` into their `when`.
 * Called before the workbench starts, after the workbench's contributions
 * have registered them; an item a VS Code bump renames is reported, not fatal.
 */
export function amendTabBarMenus(): void {
  const gate = (item: { when?: ContextKeyExpression }) => {
    item.when = ContextKeyExpr.and(item.when, VSCodeModeContext);
  };
  const submenu = MenuRegistry.getMenuItems(MenuId.EditorTabsBarContext).find(
    (item) => isISubmenuItem(item) && item.submenu === MenuId.EditorTabsBarShowTabsSubmenu,
  );
  if (submenu) gate(submenu);
  else console.warn("[pult-shell] the tabs bar's Tab Bar submenu is not registered");
  const commands = MenuRegistry.getMenuItems(MenuId.CommandPalette).filter(
    (item) => isIMenuItem(item) && TAB_MODE_COMMANDS.has(item.command.id),
  );
  commands.forEach(gate);
  if (commands.length !== TAB_MODE_COMMANDS.size) console.warn("[pult-shell] not every tab bar mode command is in the palette");
}
