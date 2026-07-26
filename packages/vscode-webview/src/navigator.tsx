import { ExternalLink, FolderGit2, FolderOpen, ListTodo, Plus } from 'lucide-react';

import { AuthPrompt } from './components/auth-prompt';
import { CollapsibleSection } from './components/collapsible-section';
import { DocList } from './components/doc-list';
import { FeatureList } from './components/feature-list';
import { WorkspacePill } from './components/header';
import { UserMenu } from './components/user-menu';
import { VersionBlocked } from './components/version-blocked';
import { WorkspacePanel } from './components/workspace-panel';
import { useNavigatorController } from './state/use-navigator-controller';

/**
 * Navigator app — the extension's one webview (primary sidebar). Lists the
 * current workspace's linked local repos, documents, and features; clicking
 * a doc opens it, relaying through the extension host (see
 * NavigatorPanelProvider).
 */
export function Navigator() {
  const c = useNavigatorController();

  if (c.versionBlocked) {
    return <VersionBlocked entry={c.versionBlocked} onUpdate={c.openMarketplace} />;
  }

  if (!c.isConnected) {
    return <AuthPrompt visible onConnect={c.connect} />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-3">
        <WorkspacePill workspaceLabel={c.workspaceLabel} onSwitchWorkspace={c.switchWorkspace} />
        <UserMenu
          profile={c.userProfile}
          onSignOut={c.signOut}
          onOpenProfileSettings={c.openProfileSettings}
        />
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
            title="Workspace"
            icon={<FolderGit2 className="h-3 w-3 shrink-0" aria-hidden="true" />}
            action={
              c.hasWorkspaceFolder ? (
                <button
                  type="button"
                  title="Add repo"
                  onClick={c.addRepo}
                  className="shrink-0 rounded p-1 text-text-muted hover:bg-surface-secondary hover:text-text-primary"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : undefined
            }
          >
            <WorkspacePanel
              repos={c.repos}
              hasWorkspaceFolder={c.hasWorkspaceFolder}
              onOpenWorkspaceFolder={c.openWorkspaceFolder}
              onAddRepo={c.addRepo}
              mcpCliStatus={c.mcpCliStatus}
              mcpCliInstalling={c.mcpCliInstalling}
              onInstallMcpCli={c.installMcpCli}
              mcpStatuses={c.mcpStatuses}
              pendingAgents={c.pendingAgents}
              onConnectAgent={c.connectAgent}
              onDisconnectAgent={c.disconnectAgent}
              onTagInPrompt={c.tagInPrompt}
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
              onTagInPrompt={c.tagInPrompt}
            />
          </CollapsibleSection>

          <CollapsibleSection
            title="Features"
            icon={<ListTodo className="h-3 w-3 shrink-0" aria-hidden="true" />}
            defaultOpen={false}
            action={
              <button
                type="button"
                title="Open all features"
                onClick={c.openFeaturesBrowser}
                className="shrink-0 rounded p-1 text-text-muted hover:bg-surface-secondary hover:text-text-primary"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            }
          >
            <FeatureList
              features={c.features}
              onOpenFeatureDetail={c.openFeatureDetail}
              onTagInPrompt={c.tagInPrompt}
            />
          </CollapsibleSection>
        </div>
      )}
    </div>
  );
}
