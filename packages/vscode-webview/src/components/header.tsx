import { ChevronDown } from 'lucide-react';

import { deriveIconColor } from '../utils/icon-colors.ts';

/** 18px colored-initial square — mirrors digital-factory-ui's org/workspace
 * switcher pill (IconSquare in org-workspace-switcher.tsx) exactly, so the
 * IDE's breadcrumb reads as the same visual language as the browser app's.
 * Seeded by display name rather than org/workspace id (the id isn't plumbed
 * to the webview today — see AuthManager.switchWorkspace) — stable enough in
 * practice, just shifts color on a rename rather than never. */
export function IconSquare({ name, className }: { name: string; className?: string }) {
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={
        'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] text-[9px] font-bold text-white' +
        (className ? ` ${className}` : '')
      }
      style={{ background: deriveIconColor(name) }}
    >
      {initial}
    </span>
  );
}

/** Org/workspace breadcrumb pill — the whole pill is the switch-workspace
 * trigger (switching itself is a VS Code QuickPick sequence run by the
 * extension host, not a dropdown here), matching digital-factory-ui's
 * OrgWorkspaceSwitcher trigger button styling. */
export function WorkspacePill({
  workspaceLabel,
  environmentLabel,
  onSwitchWorkspace,
}: {
  workspaceLabel: string | null;
  /** The active account's environment (e.g. "staging", a custom bffUrl) —
   * shown as a small tag so it's obvious at a glance which backend a local
   * agent's MCP calls will actually hit, before invoking one. Omitted for
   * "Production" (the overwhelming common case) to keep the header visually
   * quiet there — see AuthManager's environmentLabelForBffUrl. */
  environmentLabel?: string | null;
  onSwitchWorkspace: () => void;
}) {
  const parts = workspaceLabel ? workspaceLabel.split(' · ') : [];
  const workspaceName = parts[0];
  const orgName = parts[1];
  const showEnvironmentTag = !!environmentLabel && environmentLabel !== 'Production';

  return (
    <button
      type="button"
      className="flex h-7 min-w-0 shrink items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-text-primary hover:bg-surface-secondary"
      title={workspaceLabel ? `Workspace: ${workspaceLabel}` : 'Select workspace'}
      onClick={onSwitchWorkspace}
    >
      {showEnvironmentTag && (
        <span className="max-[300px]:hidden shrink-0 rounded bg-surface-secondary px-1 py-px text-[9px] font-medium uppercase tracking-wide text-text-muted">
          {environmentLabel}
        </span>
      )}
      {orgName ? (
        <>
          {/* Org icon/name/slash drop below ~300px of panel width, keeping
              only the workspace half — the workspace is the more useful
              identifier day-to-day, and the button's own title tooltip still
              carries the full "org / workspace" label. Lets the whole top
              bar (workspace pill + New session + avatar) fit on one line
              instead of wrapping. */}
          <IconSquare name={orgName} className="max-[300px]:hidden" />
          <span className="min-w-0 max-w-20 truncate max-[300px]:hidden">{orgName}</span>
          <span className="text-text-muted max-[300px]:hidden" aria-hidden="true">
            /
          </span>
          <IconSquare name={workspaceName} />
          <span className="min-w-0 max-w-20 truncate">{workspaceName}</span>
        </>
      ) : (
        <span className="text-text-muted">Select workspace</span>
      )}
      <ChevronDown className="h-3 w-3 shrink-0 text-text-muted" aria-hidden="true" />
    </button>
  );
}
