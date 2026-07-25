import { FolderOpen, History, ListTodo, Plus } from 'lucide-react';
import { useMemo } from 'react';

import { AuthPrompt } from './components/auth-prompt';
import { CollapsibleSection } from './components/collapsible-section';
import { DocList } from './components/doc-list';
import { FeatureList } from './components/feature-list';
import { WorkspacePill } from './components/header';
import { SessionList } from './components/session-list';
import { UserMenu } from './components/user-menu';
import { VersionBlocked } from './components/version-blocked';
import { useNavigatorController } from './state/use-navigator-controller';

/**
 * Navigator app — the primary-sidebar counterpart to the chat webview
 * (packages/vscode-webview/src/app.tsx), which now lives in the secondary
 * sidebar. Lists the current workspace's chat sessions, documents, and
 * features; loading a session or clicking a doc/feature relays through the
 * extension host to the chat webview (see NavigatorPanelProvider).
 */
export function Navigator() {
  const c = useNavigatorController();

  // id -> name, for SessionList's HighlightedText to resolve `<ft:>`/`<d:>`
  // tags in a session's title/excerpt — by the time a tag reaches a stored
  // session, its feature reference is a raw UUID (mentions.ts's
  // resolveMentions rewrites the human-typed slug before the message is
  // ever sent), so without this lookup the chip permanently shows a UUID.
  // Reuses c.features — already loaded for the Features section below, no
  // separate fetch needed.
  const featureNames = useMemo(
    () => Object.fromEntries(c.features.map((f) => [f.id, f.feature_name])),
    [c.features],
  );
  // Feature id -> status (the lifecycle-stage vocabulary — see
  // feature-list.tsx's own LifecycleGlyph usage), for the same chip's
  // status glyph.
  const featureStages = useMemo(
    () => Object.fromEntries(c.features.map((f) => [f.id, f.status])),
    [c.features],
  );

  if (c.versionBlocked) {
    return <VersionBlocked entry={c.versionBlocked} onUpdate={c.openMarketplace} />;
  }

  if (!c.isConnected) {
    return <AuthPrompt visible onConnect={c.connect} />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Stays on one line by design — WorkspacePill (header.tsx) already
          collapses its org half away below 300px, and the New session
          button drops its text label below 280px, so both sides shrink
          enough to fit together before flex-wrap would ever need to kick
          in. Wrapping to a second line reads worse than either collapse. */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-3">
        <WorkspacePill workspaceLabel={c.workspaceLabel} onSwitchWorkspace={c.switchWorkspace} />
        <div className="flex shrink-0 items-center gap-2">
          <button
            className="flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-text-primary hover:bg-surface-secondary"
            title="New session"
            onClick={c.newChat}
          >
            <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {/* Hidden rather than removed below ~280px of panel width — the
                icon + title tooltip alone still make the action discoverable,
                same pattern VS Code's own narrow toolbars use. */}
            <span className="max-[280px]:hidden">New session</span>
          </button>
          <UserMenu
            profile={c.userProfile}
            onSignOut={c.signOut}
            onOpenProfileSettings={c.openProfileSettings}
          />
        </div>
      </div>

      {!c.workspaceLabel ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-sm text-text-secondary">Select a workspace to get started.</p>
          <button
            className="rounded bg-primary px-4 py-1.5 text-xs text-primary-foreground hover:bg-primary-hover"
            onClick={c.switchWorkspace}
          >
            Select workspace
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <CollapsibleSection
            title="Sessions"
            icon={<History className="h-3 w-3 shrink-0" aria-hidden="true" />}
          >
            <SessionList
              sessions={c.sessions}
              onLoad={c.loadSession}
              onDelete={c.deleteSession}
              featureNames={featureNames}
              featureStages={featureStages}
            />
          </CollapsibleSection>

          <CollapsibleSection
            title="Docs"
            icon={<FolderOpen className="h-3 w-3 shrink-0" aria-hidden="true" />}
            defaultOpen={false}
          >
            <DocList
              docs={c.docs}
              features={c.features}
              onOpenDocument={c.openDocument}
              onInsertMention={c.insertMention}
            />
          </CollapsibleSection>

          <CollapsibleSection
            title="Features"
            icon={<ListTodo className="h-3 w-3 shrink-0" aria-hidden="true" />}
            defaultOpen={false}
          >
            <FeatureList
              features={c.features}
              taskCache={c.taskCache}
              onRequestTasks={c.requestFeatureTasks}
              onInsertMention={c.insertMention}
            />
          </CollapsibleSection>
        </div>
      )}
    </div>
  );
}
