import { ChevronDown, Pencil } from 'lucide-react';

import { HighlightedText } from '../utils/chip-styles.tsx';
import { deriveIconColor } from '../utils/icon-colors.ts';

interface HeaderProps {
  visible: boolean;
  title: string;
  onNewChat: () => void;
  /** Feature id -> name, for HighlightedText to resolve `<ft:>`/`<d:>` tags
   * in the title (the first user turn's raw text — see app.tsx) instead of
   * showing the raw UUID those tags carry post-send. */
  featureNames?: Record<string, string>;
  /** Feature id -> status, for a `<ft:>` chip's LifecycleGlyph. */
  featureStages?: Record<string, string>;
}

const ICON_BTN_CLASS =
  'inline-flex items-center justify-center rounded p-1 text-text-primary opacity-60 hover:bg-surface-secondary hover:opacity-100';

/** 18px colored-initial square — mirrors digital-factory-ui's org/workspace
 * switcher pill (IconSquare in org-workspace-switcher.tsx) exactly, so the
 * IDE's breadcrumb reads as the same visual language as the browser app's.
 * Seeded by display name rather than org/workspace id (the id isn't plumbed
 * to the webview today — see AuthManager.switchWorkspace) — stable enough in
 * practice, just shifts color on a rename rather than never. */
function IconSquare({ name }: { name: string }) {
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] text-[9px] font-bold text-white"
      style={{ background: deriveIconColor(name) }}
    >
      {initial}
    </span>
  );
}

/** Org/workspace breadcrumb pill — the whole pill is the switch-workspace
 * trigger (switching itself is a VS Code QuickPick sequence run by the
 * extension host, not a dropdown here), matching digital-factory-ui's
 * OrgWorkspaceSwitcher trigger button styling. Shared by the chat header and
 * the navigator header (each has its own workspace pill instance). */
export function WorkspacePill({
  workspaceLabel,
  onSwitchWorkspace,
}: {
  workspaceLabel: string | null;
  onSwitchWorkspace: () => void;
}) {
  const parts = workspaceLabel ? workspaceLabel.split(' · ') : [];
  const workspaceName = parts[0];
  const orgName = parts[1];

  return (
    <button
      type="button"
      className="flex h-7 min-w-0 shrink items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-text-primary hover:bg-surface-secondary"
      title={workspaceLabel ? `Workspace: ${workspaceLabel}` : 'Select workspace'}
      onClick={onSwitchWorkspace}
    >
      {orgName ? (
        <>
          <IconSquare name={orgName} />
          <span className="max-w-20 truncate">{orgName}</span>
          <span className="text-text-muted" aria-hidden="true">
            /
          </span>
          <IconSquare name={workspaceName} />
          <span className="max-w-20 truncate">{workspaceName}</span>
        </>
      ) : (
        <span className="text-text-muted">Select workspace</span>
      )}
      <ChevronDown className="h-3 w-3 shrink-0 text-text-muted" aria-hidden="true" />
    </button>
  );
}

export function Header({ visible, title, onNewChat, featureNames, featureStages }: HeaderProps) {
  return (
    <div
      className={
        (visible ? 'flex' : 'hidden') +
        ' shrink-0 items-center gap-2 border-b border-border px-3 py-2.5'
      }
    >
      {/* The native title attribute can only ever be plain text (no chip
          styling possible in a browser tooltip) — kept as the raw string so
          hovering still shows the full, untruncated title; the visible
          span below renders the same text through HighlightedText instead. */}
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold" title={title}>
        <HighlightedText text={title} featureNames={featureNames} featureStages={featureStages} />
      </span>
      <button className={ICON_BTN_CLASS} title="New chat" onClick={onNewChat}>
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
