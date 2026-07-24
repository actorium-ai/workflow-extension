import { Popover } from '@heroui/react';
import { LogOut, UserCircle } from 'lucide-react';
import { useState } from 'react';

import { deriveIconColor } from '../utils/icon-colors.ts';
import type { MeUser } from '../utils/types.ts';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** 22px circular avatar — photo if available (falls back on load failure,
 * not just a missing URL), else a colored-initials circle. Mirrors
 * digital-factory-ui's UserAvatar (components/common/user-avatar.tsx). */
function Avatar({ profile }: { profile: MeUser | null }) {
  const [errored, setErrored] = useState(false);
  const name = profile?.display_name || profile?.email || '?';

  if (profile?.avatar_url && !errored) {
    return (
      <img
        src={profile.avatar_url}
        alt=""
        onError={() => setErrored(true)}
        className="h-[22px] w-[22px] shrink-0 rounded-full object-cover"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
      style={{ background: deriveIconColor(profile?.id ?? name) }}
    >
      {initials(name)}
    </span>
  );
}

/** Account menu — avatar button opens a popover with name/email, Profile
 * settings, and Sign out, mirroring digital-factory-ui's topbar UserMenu
 * (components/shell/topbar.tsx). Lives in the navigator (primary-sidebar)
 * header, not the chat header — one account per workspace connection,
 * shown alongside the workspace switcher it's paired with. Sign-out and
 * profile-settings both round-trip through the extension host
 * (postMessage), which owns the actual disconnect()/openExternal() calls. */
export function UserMenu({
  profile,
  onSignOut,
  onOpenProfileSettings,
}: {
  profile: MeUser | null;
  onSignOut: () => void;
  onOpenProfileSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const name = profile?.display_name || profile?.email || 'Actorium account';

  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Popover.Trigger>
        <button
          type="button"
          className="flex shrink-0 items-center justify-center rounded-full opacity-90 hover:opacity-100"
          title={profile?.email || 'Account'}
        >
          <Avatar profile={profile} />
        </button>
      </Popover.Trigger>
      <Popover.Content placement="bottom end" className="border-0 bg-transparent p-0 shadow-none">
        <Popover.Dialog className="min-w-44 overflow-hidden rounded-lg border border-border bg-surface p-0 shadow-xl outline-none">
          <div className="border-b border-border px-3 py-2.5">
            <p className="truncate text-xs font-medium text-text-primary">{name}</p>
            {profile?.email && (
              <p className="truncate text-[11px] text-text-muted">{profile.email}</p>
            )}
          </div>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
            onClick={() => {
              setOpen(false);
              onOpenProfileSettings();
            }}
          >
            <UserCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Profile settings
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-danger hover:bg-surface-secondary"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Sign out
          </button>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
