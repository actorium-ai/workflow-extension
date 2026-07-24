/**
 * Per-org daily/weekly usage — mirrors digital-factory-ui's own
 * `src/services/user-service/usage.ts` OrgUsage shape and
 * `src/hooks/settings/use-quota.ts` computeBarState/countdown formatting,
 * since both apps read the exact same GET /api/me/usage endpoint (served by
 * user-service's handler.MeUsage) and should present the same numbers the
 * same way. Not imported directly (different repo/build) — small enough to
 * duplicate faithfully rather than share.
 */

export type OrgUsage = {
  org_id: string;
  org_slug: string;
  org_name: string;
  role: string;
  plan_name: string;
  plan_display_name: string;
  daily_used: number;
  daily_cap: number;
  weekly_used: number;
  weekly_cap: number;
  daily_reset_at: string;
  weekly_reset_at: string;
};

/**
 * Fetch the caller's per-org usage from user-service (via the BFF proxy),
 * sent as a bearer device-flow JWT — same pattern as AuthManager's own
 * _fetchOrgs()/_fetchWorkspaces(). Returns [] on any failure (fails open —
 * the status bar just shows no usage card rather than an error).
 */
export async function fetchUsage(userServiceUrl: string, token: string): Promise<OrgUsage[]> {
  try {
    const resp = await fetch(`${userServiceUrl}/api/me/usage`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return [];
    const body = (await resp.json()) as { data?: { sections?: OrgUsage[] }; sections?: OrgUsage[] };
    const payload = body.data ?? body;
    return payload.sections ?? [];
  } catch {
    return [];
  }
}

export type BarColor = 'neutral' | 'warning' | 'danger';

export interface BarState {
  used: number;
  cap: number;
  pct: number;
  color: BarColor;
  resetAt: Date;
}

/** neutral < 80%, warning 80–99%, danger 100%+ — same thresholds as digital-factory-ui's computeBarState. */
export function computeBarState(used: number, cap: number, resetAt: string): BarState {
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const color: BarColor = pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : 'neutral';
  return { used, cap, pct, color, resetAt: new Date(resetAt) };
}

export function formatDailyCountdown(resetAt: Date, now: Date): string {
  const diffMs = resetAt.getTime() - now.getTime();
  if (diffMs <= 0) return 'Resets soon';
  const totalMins = Math.floor(diffMs / 60_000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return `Resets in ${hrs}h ${mins}m`;
}

export function formatWeeklyCountdown(resetAt: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const day = days[resetAt.getDay()];
  const hours = resetAt.getHours();
  const mins = resetAt.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h = hours % 12 || 12;
  const m = mins.toString().padStart(2, '0');
  return `Resets ${day} ${h}:${m} ${ampm}`;
}

const BAR_WIDTH = 20;
const BAR_ICON: Record<BarColor, string> = {
  neutral: '$(circle-filled)',
  warning: '$(warning)',
  danger: '$(error)',
};

/** A text progress bar (filled/empty block characters) for a MarkdownString
 * tooltip — deliberately not an embedded SVG/HTML bar: block characters
 * render identically regardless of host theme/HTML support, whereas a
 * `supportHtml` div's exact look isn't something this can be visually
 * verified against a real VS Code window from here. */
export function renderBar(pct: number): string {
  const filled = Math.round((Math.min(100, Math.max(0, pct)) / 100) * BAR_WIDTH);
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
}

export function barIcon(color: BarColor): string {
  return BAR_ICON[color];
}
