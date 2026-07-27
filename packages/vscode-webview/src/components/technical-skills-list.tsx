import { Loader2 } from 'lucide-react';

import type { AgentTarget, TechnicalSkillsStatuses } from '../utils/types.ts';
import { CliIcon } from './cli-icon.tsx';

const SKILLS_LABELS: Record<AgentTarget, string> = {
  claude: 'Claude Technical Skills',
  codex: 'Codex Technical Skills',
  opencode: 'opencode Technical Skills',
};

const TARGETS: AgentTarget[] = ['claude', 'codex', 'opencode'];

interface TechnicalSkillsListProps {
  statuses: TechnicalSkillsStatuses;
  installing: Set<AgentTarget>;
  onInstall: (target: AgentTarget) => void;
  onUninstall: (target: AgentTarget) => void;
}

/**
 * Copies workflow-extension's bundled Claude Technical Skills (curated
 * SKILL.md folders — see the extension host's src/workspace/
 * technicalSkills.ts) into each agent's own skills directory
 * (.claude/skills, .codex/skills, .opencode/skills) inside the workspace
 * folder. Each row's action flips between Install/Uninstall based on
 * current status, mirroring AgentStatusList's Connect/Disconnect toggle.
 */
export function TechnicalSkillsList({
  statuses,
  installing,
  onInstall,
  onUninstall,
}: TechnicalSkillsListProps) {
  return (
    <>
      {TARGETS.map((target) => {
        const status = statuses[target];
        const installed = status?.installed ?? false;
        const busy = installing.has(target);
        return (
          <div
            key={target}
            title={
              status && status.total > 0
                ? installed
                  ? `All ${status.total} skills installed`
                  : 'Not yet installed'
                : undefined
            }
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5"
          >
            <span className="relative shrink-0">
              <CliIcon name={target} />
              <span
                className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-bg ${
                  installed ? 'bg-success' : 'bg-text-muted'
                }`}
                aria-hidden="true"
              />
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
              {SKILLS_LABELS[target]}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => (installed ? onUninstall(target) : onInstall(target))}
              className={
                'flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium disabled:pointer-events-none disabled:opacity-60' +
                (installed
                  ? ' text-text-muted hover:bg-danger/10 hover:text-danger'
                  : ' text-accent-foreground hover:bg-primary/10')
              }
            >
              {busy && <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />}
              {busy
                ? installed
                  ? 'Uninstalling…'
                  : 'Installing…'
                : installed
                  ? 'Uninstall'
                  : 'Install'}
            </button>
          </div>
        );
      })}
    </>
  );
}
