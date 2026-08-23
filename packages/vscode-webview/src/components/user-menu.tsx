import { Popover } from '@heroui/react';
import { LogOut, Plus, RefreshCw, RotateCw, UserCircle } from 'lucide-react';
import { useState } from 'react';

import { deriveIconColor } from '../utils/icon-colors.ts';
import type { AccountSummary, MeUser } from '../utils/types.ts';

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

/** Account menu — avatar button opens a popover with name/email, other
 * signed-in accounts to switch to, an "Add account" row, Profile settings,
 * and Sign out (scoped to the active account) — mirroring digital-factory-ui's
 * topbar UserMenu (components/shell/topbar.tsx) with a switcher layered on
 * top. Lives in the navigator (primary-sidebar) header, not the chat header,
 * shown alongside the workspace switcher it's paired with. Every account row
 * click, sign-out, and profile-settings action round-trips through the
 * extension host (postMessage), which owns the actual switchAccount()/
 * startDeviceFlowForNewAccount()/disconnect()/openExternal() calls — nothing
 * here re-implements a picker or the device flow.
 *
 * sessionExpired reflects the ACTIVE account only (there's no token-refresh
 * flow — see AuthManager's class doc comment) — a small dot on the avatar and
 * a "Reconnect" row surface it, both re-authenticating the same account in
 * place rather than starting a fresh login. */
export function UserMenu({
  profile,
  accounts,
  sessionExpired,
  onSignOut,
  onOpenProfileSettings,
  onSwitchAccount,
  onAddAccount,
  onReconnect,
  onReload,
}: {
  profile: MeUser | null;
  accounts: AccountSummary[];
  sessionExpired: boolean;
  onSignOut: () => void;
  onOpenProfileSettings: () => void;
  onSwitchAccount: (accountId: string) => void;
  onAddAccount: () => void;
  onReconnect: () => void;
  onReload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const name = profile?.display_name || profile?.email || 'Actorium account';
  const otherAccounts = accounts.filter((account) => !account.isActive);

  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Popover.Trigger>
        <button
          type="button"
          className="relative flex shrink-0 items-center justify-center rounded-full opacity-90 hover:opacity-100"
          title={
            sessionExpired ? 'Session expired — click to reconnect' : profile?.email || 'Account'
          }
        >
          <Avatar profile={profile} />
          {sessionExpired && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-danger ring-1 ring-surface"
            />
          )}
        </button>
      </Popover.Trigger>
      <Popover.Content placement="bottom end" className="border-0 bg-transparent p-0 shadow-none">
        <Popover.Dialog className="min-w-52 overflow-hidden rounded-lg border border-border bg-surface p-0 shadow-xl outline-none">
          <div className="border-b border-border px-3 py-2.5">
            <p className="truncate text-xs font-medium text-text-primary">{name}</p>
            {profile?.email && (
              <p className="truncate text-[11px] text-text-muted">{profile.email}</p>
            )}
          </div>
          {sessionExpired && (
            <button
              type="button"
              className="flex w-full items-center gap-2 border-b border-border bg-danger/10 px-3 py-2 text-left text-xs text-danger hover:bg-danger/20"
              onClick={() => {
                setOpen(false);
                onReconnect();
              }}
            >
              <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Session expired — Reconnect
            </button>
          )}
          {otherAccounts.length > 0 && (
            <div className="border-b border-border py-1">
              {otherAccounts.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
                  onClick={() => {
                    setOpen(false);
                    onSwitchAccount(account.id);
                  }}
                >
                  <Avatar profile={account.user} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs">
                      {account.user.display_name || account.user.email}
                    </span>
                    <span className="block truncate text-[10px] text-text-muted">
                      {account.environmentLabel}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-xs text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
            onClick={() => {
              setOpen(false);
              onAddAccount();
            }}
          >
            <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Add account
          </button>
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
            className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-xs text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
            onClick={() => {
              setOpen(false);
              onReload();
            }}
          >
            <RotateCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Reload window
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
