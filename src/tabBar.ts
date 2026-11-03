import { MenuId, MenuRegistry } from "@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions";
import { ContextKeyExpr } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey";

/**
 * The tabs bar's Tab Bar submenu (Multiple, Single, None) on the single tab's
 * context menu too: the stock way back from Single is the menu bar's
 * Appearance, which the shell has none of, so the way out sits where the way
 * in was, a right-click on the tabs' row.
 */
export function registerTabBarMenu(): void {
  MenuRegistry.appendMenuItem(MenuId.EditorTitleContext, {
    submenu: MenuId.EditorTabsBarShowTabsSubmenu,
    title: "Tab Bar",
    group: "z_tab_bar",
    when: ContextKeyExpr.equals("config.workbench.editor.showTabs", "single"),
  });
}
