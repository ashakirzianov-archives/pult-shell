import { getService, ICommandService, IContextKeyService } from "@codingame/monaco-vscode-api";
import { MenuId } from "@codingame/monaco-vscode-api/vscode/vs/platform/actions/common/actions";
import { IContextMenuService } from "@codingame/monaco-vscode-api/vscode/vs/platform/contextview/browser/contextView.service";
import { useRef, useSyncExternalStore } from "react";

import { connection, environmentName, type ShellEnvironment } from "../connection/index.ts";
import { setUsageLimitsMode, USAGE_LIMITS_MODES, usageLimitsMode } from "../limits/index.ts";
import { type modeChoice, MODES, setMode } from "../mode.ts";
import { SETTLED_CHOICES, setSettledShelf, settledShelf } from "../panel/settings.ts";
import { COLOR_SCHEMES, type colorSchemeChoice, setColorScheme } from "./colorScheme.ts";

function run(command: string, ...args: unknown[]): void {
  void getService(ICommandService).then((commands) => commands.executeCommand(command, ...args));
}

/**
 * The Pult settings page, a tab among the selected thread's (`pane.tsx`):
 * Pult's own settings first, then the workbench's Manage menu behind one
 * button, whose editors open as tabs beside it.
 */
export function SettingsPage({ colorScheme, mode }: { colorScheme: ColorSchemeChoice; mode: ModeChoice }) {
  return (
    <div className="pult-settings">
      <h1 className="pult-settings-title">Settings</h1>
      <EnvironmentsSection />
      <AppearanceSection colorScheme={colorScheme} />
      <PanelSection />
      <ModeSection mode={mode} />
      <VSCodeSection />
    </div>
  );
}

const PHASES: Record<ShellEnvironment["phase"], string> = {
  connecting: "Connecting",
  ready: "Connected",
  reconnecting: "Reconnecting",
  offline: "Offline",
  blocked: "Blocked",
};

/**
 * Every environment the page holds, in the order they were connected, each
 * with its server's host, how its connection stands and why when it is not
 * ready, and Disconnect, and Retry while it is not ready; then Connect to
 * Environment, which adds one. The palette's Pult: Connect to Environment,
 * Disconnect and Retry Connection are the same commands.
 */
function EnvironmentsSection() {
  const environments = useSyncExternalStore(
    (listener) => connection.onDidChange(listener),
    () => connection.environments,
  );
  return (
    <section className="pult-settings-section">
      <h2>Environments</h2>
      {environments.length === 0 ? (
        <p className="pult-settings-note">Pult is not connected to an environment.</p>
      ) : (
        <ul className="pult-settings-rows">
          {environments.map((environment) => (
            <li key={environment.environmentId} className="pult-settings-row">
              <div className="pult-settings-row-text">
                <div className="pult-settings-row-label">{environmentName(environment, environments)}</div>
                <div className="pult-settings-row-description">
                  {[hostOf(environment), PHASES[environment.phase]].filter((part) => part !== undefined).join(" · ")}
                </div>
                {environment.error === null ? null : <div className="pult-settings-row-error">{environment.error}</div>}
              </div>
              <div className="pult-settings-row-actions">
                {environment.phase === "ready" ? null : (
                  <button
                    type="button"
                    className="pult-settings-button"
                    onClick={() => run("pult-shell.retryConnection", environment.environmentId)}
                  >
                    Retry
                  </button>
                )}
                <button
                  type="button"
                  className="pult-settings-button"
                  onClick={() => run("pult-shell.disconnect", environment.environmentId)}
                >
                  Disconnect
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="pult-settings-button pult-settings-button-primary" onClick={() => run("pult-shell.connect")}>
        Connect to Environment
      </button>
    </section>
  );
}

function hostOf(environment: ShellEnvironment): string | undefined {
  return URL.canParse(environment.httpBaseUrl) ? new URL(environment.httpBaseUrl).host : undefined;
}

type ColorSchemeChoice = Awaited<ReturnType<typeof colorSchemeChoice>>;

/**
 * The colour scheme, Light, Dark or System, one button each, the current one
 * pressed, following the workbench's theme settings however they change:
 * here, the palette's Pult: Colour Scheme… or VS Code's own Color Theme
 * picker (`colorScheme.ts`).
 */
function AppearanceSection({ colorScheme }: { colorScheme: ColorSchemeChoice }) {
  const current = useSyncExternalStore(colorScheme.onDidChange, colorScheme.current);
  return (
    <section className="pult-settings-section">
      <h2>Appearance</h2>
      <SegmentedRow
        label="Colour scheme"
        description="Light and Dark use VS Code's preferred light and dark themes; System follows the operating system."
        choices={COLOR_SCHEMES.map(({ scheme, label }) => ({ value: scheme, label }))}
        current={current}
        onChoose={(scheme) => void setColorScheme(scheme)}
      />
    </section>
  );
}

/**
 * The left panel's shelves, a row each, one button per choice, the current
 * one pressed: when the Limits shelf shows the usage limits, When warning,
 * Always or Hidden (`pult.panel.usageLimits`, `src/limits/`), which the
 * palette's Pult: Usage Limits Shelf… and the shelf header's right-click set
 * too; and whether the Settled shelf shows (`src/panel/settings.ts`), which
 * the palette's Show Settled Shelf and Hide Settled Shelf set too.
 */
function PanelSection() {
  const usageLimits = useSyncExternalStore(usageLimitsMode.subscribe, usageLimitsMode.get);
  const settled = useSyncExternalStore(settledShelf.subscribe, settledShelf.get);
  return (
    <section className="pult-settings-section">
      <h2>Panel</h2>
      <SegmentedRow
        label="Usage limits"
        description="The providers' usage limits in the Limits shelf: by default only those past 95% or on a pace that runs out before the reset."
        choices={USAGE_LIMITS_MODES.map(({ mode: choice, label }) => ({ value: choice, label }))}
        current={usageLimits}
        onChoose={(choice) => void setUsageLimitsMode(choice)}
      />
      <SegmentedRow
        label="Settled threads"
        description="Hidden, the Pult tab shows no Settled shelf; Pult: Open Thread… still reaches settled threads."
        choices={SETTLED_CHOICES}
        current={settled}
        onChoose={(choice) => void setSettledShelf(choice)}
      />
    </section>
  );
}

type ModeChoice = Awaited<ReturnType<typeof modeChoice>>;

/**
 * The mode, Pult or VS Code (`src/mode.ts`), one button each, the current
 * one pressed; the palette's Switch to VS Code Mode and Switch to Pult Mode
 * are the same setting.
 */
function ModeSection({ mode }: { mode: ModeChoice }) {
  const current = useSyncExternalStore(mode.onDidChange, mode.current);
  return (
    <section className="pult-settings-section">
      <h2>Mode</h2>
      <SegmentedRow
        label="Layout"
        description="Pult's own layout hides and rearranges much of VS Code; VS Code mode shows it all, for an extension that needs it."
        choices={MODES.map(({ mode: choice, label }) => ({ value: choice, label }))}
        current={current}
        onChoose={(choice) => void setMode(choice)}
      />
    </section>
  );
}

/** A setting's row of one button per choice, the current one pressed. */
function SegmentedRow<Value extends string>({
  label,
  description,
  choices,
  current,
  onChoose,
}: {
  label: string;
  description: string;
  choices: ReadonlyArray<{ readonly value: Value; readonly label: string }>;
  current: Value;
  onChoose: (value: Value) => void;
}) {
  return (
    <div className="pult-settings-row">
      <div className="pult-settings-row-text">
        <div className="pult-settings-row-label">{label}</div>
        <div className="pult-settings-row-description">{description}</div>
      </div>
      <div className="pult-settings-segments" role="group" aria-label={label}>
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            className="pult-settings-segment"
            aria-pressed={choice.value === current}
            onClick={() => onChoose(choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The workbench's Manage menu, which the stock activity bar's gear would
 * show; the shell hides that bar, its own gear opening this page
 * (`src/panel/rows.tsx`): one button opening the menu as the context menu
 * the stock gear opens, so VS Code's settings editor, keyboard
 * shortcuts, profiles, themes and extensions stay a click away.
 */
function VSCodeSection() {
  const button = useRef<HTMLButtonElement>(null);
  const showManageMenu = async () => {
    const anchor = button.current;
    if (anchor === null) return;
    const [contextMenus, contextKeys] = await Promise.all([getService(IContextMenuService), getService(IContextKeyService)]);
    contextMenus.showContextMenu({
      menuId: MenuId.GlobalActivity,
      menuActionOptions: { renderShortTitle: true },
      contextKeyService: contextKeys,
      getAnchor: () => anchor,
    });
  };
  return (
    <section className="pult-settings-section">
      <h2>VS Code</h2>
      <div className="pult-settings-row">
        <div className="pult-settings-row-text">
          <div className="pult-settings-row-label">VS Code settings</div>
          <div className="pult-settings-row-description">
            The workbench's own settings, keyboard shortcuts, profiles, themes and extensions, as its Manage menu offers them.
          </div>
        </div>
        <div className="pult-settings-row-actions">
          <button ref={button} type="button" className="pult-settings-button" onClick={() => void showManageMenu()}>
            Open Menu…
          </button>
        </div>
      </div>
    </section>
  );
}
