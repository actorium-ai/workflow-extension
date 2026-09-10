import { Popover } from '@heroui/react';
import { Check, LogOut, Plus, RotateCw, UserCircle } from 'lucide-react';
import { useState } from 'react';

import { deriveIconColor } from '../utils/icon-colors.ts';
import type { AccountSummary, MeUser } from '../utils/types.ts';

/** Small muted "which backend" tag — same visual treatment as header.tsx's
 * WorkspacePill environment badge, but always shown here (including
 * Production) rather than hidden for the common case: this menu's whole job
 * is comparing accounts, often across servers, so the active account's own
 * server is exactly what a user checks first when multiple are signed in. */
function EnvironmentTag({ label }: { label?: string | null }) {
  if (!label) return null;
  return (
    <span className="shrink-0 rounded bg-surface-secondary px-1 py-px text-[9px] font-medium uppercase tracking-wide text-text-muted">
      {label}
    </span>
  );
}

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

/** One row in the account list — active or not, all rendered identically
 * (avatar, name, environment tag, email/expired-state) so the popover reads
 * as "here are your N accounts, this one's checked" rather than singling the
 * active one out with a different layout. Clicking a non-active row switches
 * to it; clicking the active row does nothing unless its OWN session has
 * expired, in which case it reconnects that same account in place rather
 * than "switching" to itself. */
function AccountRow({
  account,
  onSelect,
  onReconnect,
}: {
  account: AccountSummary;
  onSelect: (accountId: string) => void;
  onReconnect: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
      onClick={() => {
        if (account.isActive) {
          if (account.sessionExpired) onReconnect();
          return;
        }
        onSelect(account.id);
      }}
    >
      <span className="relative shrink-0">
        <Avatar profile={account.user} />
        {account.sessionExpired && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-danger ring-1 ring-surface"
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-xs">
            {account.user.display_name || account.user.email}
          </span>
          <EnvironmentTag label={account.environmentLabel} />
        </span>
        {/* Only shown when it isn't already the line above (a
            display_name-less account already shows its email as the
            primary line) — avoids repeating the same email on both lines. */}
        {(account.sessionExpired || account.user.display_name) && (
          <span
            className={`block truncate text-[10px] ${account.sessionExpired ? 'text-danger' : 'text-text-muted'}`}
          >
            {account.sessionExpired ? 'Session expired — click to reconnect' : account.user.email}
          </span>
        )}
      </span>
      {account.isActive && (
        <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
      )}
    </button>
  );
}

/** Account menu — avatar button opens a popover listing every signed-in
 * account (active one checked), an "Add account" row, Profile settings, and
 * Sign out (scoped to the active account) — mirroring digital-factory-ui's
 * topbar UserMenu (components/shell/topbar.tsx) with a switcher layered on
 * top. Lives in the navigator (primary-sidebar) header, not the chat header,
 * shown alongside the workspace switcher it's paired with. Every account row
 * click, sign-out, and profile-settings action round-trips through the
 * extension host (postMessage), which owns the actual switchAccount()/
 * startDeviceFlowForNewAccount()/disconnect()/openExternal() calls — nothing
 * here re-implements a picker or the device flow. */
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
          {accounts.length > 0 && (
            <div className="border-b border-border py-1">
              {accounts.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  onSelect={(accountId) => {
                    setOpen(false);
                    onSwitchAccount(accountId);
                  }}
                  onReconnect={() => {
                    setOpen(false);
                    onReconnect();
                  }}
                />
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
