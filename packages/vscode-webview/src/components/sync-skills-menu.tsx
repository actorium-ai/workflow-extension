import { Popover } from '@heroui/react';
import { Check, Loader2, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import type { AgentTarget, TechnicalSkillsStatuses } from '../utils/types.ts';
import { CliIcon } from './cli-icon.tsx';

const TARGET_LABELS: Record<AgentTarget, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'opencode',
};

const TARGETS: AgentTarget[] = ['claude', 'codex', 'opencode'];

interface SyncSkillsMenuProps {
  statuses: TechnicalSkillsStatuses;
  installing: Set<AgentTarget>;
  onInstall: (target: AgentTarget) => void;
  onUninstall: (target: AgentTarget) => void;
}

/**
 * Single entry point for syncing this workspace's enabled skills (from
 * workflow-backend's skills registry) into any of the three agents' skills
 * directories — replaces the old always-visible per-agent Install/Uninstall
 * row (technical-skills-list.tsx) with one button that opens a checklist.
 *
 * The checklist represents *desired* state, seeded from actual install
 * status each time it opens (so opening it never proposes an unintended
 * change), and one "Sync" action reconciles: checked-but-not-installed
 * targets get installed, unchecked-but-installed targets get uninstalled.
 * Mirrors UserMenu's Popover pattern.
 */
export function SyncSkillsMenu({
  statuses,
  installing,
  onInstall,
  onUninstall,
}: SyncSkillsMenuProps) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Set<AgentTarget>>(new Set());

  // Seed the checklist from actual install state right when the popover
  // opens (not via an effect — that would set state synchronously during
  // render's commit phase and risk a cascading re-render for no benefit
  // here, since this is a direct response to a user action).
  function handleOpenChange(next: boolean) {
    if (next) {
      setChecked(new Set(TARGETS.filter((target) => statuses[target]?.installed)));
    }
    setOpen(next);
  }

  const busy = installing.size > 0;

  function toggle(target: AgentTarget) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(target)) {
        next.delete(target);
      } else {
        next.add(target);
      }
      return next;
    });
  }

  function sync() {
    for (const target of TARGETS) {
      const wantInstalled = checked.has(target);
      const isInstalled = statuses[target]?.installed ?? false;
      if (wantInstalled && !isInstalled) {
        onInstall(target);
      } else if (!wantInstalled && isInstalled) {
        onUninstall(target);
      }
    }
    setOpen(false);
  }

  return (
    <Popover isOpen={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger>
        <button
          type="button"
          disabled={busy}
          title="Sync skills into an agent's skills directory"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-text-secondary hover:bg-surface-secondary hover:text-text-primary disabled:pointer-events-none disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1 truncate">{busy ? 'Syncing…' : 'Sync Skills'}</span>
        </button>
      </Popover.Trigger>
      <Popover.Content placement="bottom start" className="border-0 bg-transparent p-0 shadow-none">
        <Popover.Dialog className="min-w-52 overflow-hidden rounded-lg border border-border bg-surface p-0 shadow-xl outline-none">
          <div className="border-b border-border py-1">
            {TARGETS.map((target) => (
              <button
                key={target}
                type="button"
                onClick={() => toggle(target)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
              >
                <CliIcon name={target} />
                <span className="min-w-0 flex-1 truncate">{TARGET_LABELS[target]}</span>
                {checked.has(target) && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={sync}
            className="flex w-full items-center justify-center px-3 py-2 text-xs font-medium text-accent-foreground hover:bg-primary/10"
          >
            Sync
          </button>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
