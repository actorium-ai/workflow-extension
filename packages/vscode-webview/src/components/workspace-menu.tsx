import { Popover } from '@heroui/react';
import { CloudDownload, EllipsisVertical, Loader2, Unlink, Wrench } from 'lucide-react';
import { useState } from 'react';

interface WorkspaceMenuProps {
  onCloneAllRepos: () => void;
  cloningAll: boolean;
  onRepair: () => void;
  repairing: boolean;
  /** Drops the extension's link between this workspace and its local folder
   * — see the extension host's src/navigator/panel.ts
   * _unlinkWorkspaceFolder. Nothing on disk is deleted; the panel falls back
   * to its "link a folder" empty state afterward. */
  onUnlinkWorkspace: () => void;
}

/** Overflow menu for the "Workspace" section header — houses actions that
 * don't need their own always-visible icon: cloning every unlinked repo
 * (see the extension host's src/navigator/panel.ts _cloneAllRepos),
 * repairing repo-links.json/AGENTS.md/workspace.json from current state
 * (_repairWorkspace) for when any of those have drifted, and unlinking the
 * workspace folder entirely (_unlinkWorkspaceFolder). */
export function WorkspaceMenu({
  onCloneAllRepos,
  cloningAll,
  onRepair,
  repairing,
  onUnlinkWorkspace,
}: WorkspaceMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Popover.Trigger>
        <button
          type="button"
          title="More workspace actions"
          className="shrink-0 rounded p-1 text-text-muted hover:bg-surface-secondary hover:text-text-primary"
        >
          <EllipsisVertical className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Content placement="bottom end" className="border-0 bg-transparent p-0 shadow-none">
        <Popover.Dialog className="min-w-40 overflow-hidden rounded-lg border border-border bg-surface p-0 shadow-xl outline-none">
          <button
            type="button"
            disabled={cloningAll}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary hover:bg-surface-secondary hover:text-text-primary disabled:pointer-events-none disabled:opacity-60"
            onClick={() => {
              setOpen(false);
              onCloneAllRepos();
            }}
          >
            {cloningAll ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
            ) : (
              <CloudDownload className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            Clone repo
          </button>
          <button
            type="button"
            disabled={repairing}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary hover:bg-surface-secondary hover:text-text-primary disabled:pointer-events-none disabled:opacity-60"
            onClick={() => {
              setOpen(false);
              onRepair();
            }}
          >
            {repairing ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
            ) : (
              <Wrench className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            Repair
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-xs text-danger hover:bg-surface-secondary"
            onClick={() => {
              setOpen(false);
              onUnlinkWorkspace();
            }}
          >
            <Unlink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Unlink workspace
          </button>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
