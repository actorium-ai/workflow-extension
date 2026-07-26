import type { CliIconName } from '../utils/cli-icons.ts';
import { getCliIconUrl } from '../utils/cli-icons.ts';

/** Which logos already ship as a fully self-contained square badge (their
 * own background + rounded corners baked into the SVG itself, e.g.
 * codex.svg's white rounded-rect) vs a bare glyph with no background
 * (claude.svg, opencode.svg) that needs a neutral square behind it to read
 * as an icon rather than floating artwork. */
const SELF_CONTAINED: Record<CliIconName, boolean> = {
  'actorium-mcp': true,
  claude: false,
  codex: true,
  opencode: false,
};

/** 18px icon for a coding agent or the actorium-mcp CLI itself — real brand
 * logos (see public/images/cli/*.svg) instead of a colored-initial square,
 * matching how each tool actually presents itself elsewhere. */
export function CliIcon({ name, className }: { name: CliIconName; className?: string }) {
  const src = getCliIconUrl(name);
  const base = 'h-[18px] w-[18px] shrink-0 rounded-[6px]' + (className ? ` ${className}` : '');

  if (!src) {
    // Host hasn't injected an icon URL (e.g. running outside the extension
    // host) — an empty placeholder square rather than a broken <img>.
    return <span className={`${base} bg-surface-secondary`} aria-hidden="true" />;
  }

  if (SELF_CONTAINED[name]) {
    return <img src={src} alt="" className={base} />;
  }

  return (
    <span className={`flex items-center justify-center bg-white ${base}`} aria-hidden="true">
      <img src={src} alt="" className="h-3 w-3" />
    </span>
  );
}
