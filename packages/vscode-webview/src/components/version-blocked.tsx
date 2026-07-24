import { TriangleAlert } from 'lucide-react';

import type { VersionEntry } from '../utils/types.ts';

interface VersionBlockedProps {
  entry: VersionEntry;
  onUpdate: () => void;
}

/**
 * Persistent, non-dismissible block overlay — replaces the ENTIRE panel UI
 * (header, transcript/lists, composer) until the extension is updated.
 * Unlike VersionChecker's native showErrorMessage toast (still shown once,
 * for visibility), there's no close button and no way to see or interact
 * with anything underneath: an incompatible extension version can silently
 * send malformed requests the backend no longer understands, so "let the
 * user dismiss and keep going" isn't safe here the way an update *nudge* is.
 */
export function VersionBlocked({ entry, onUpdate }: VersionBlockedProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/10">
        <TriangleAlert className="h-6 w-6 text-danger" aria-hidden="true" />
      </div>
      <div className="space-y-1.5">
        <h3 className="text-base font-semibold text-text-primary">Update required</h3>
        <p className="max-w-[280px] text-sm text-text-secondary">
          This extension version is no longer compatible with the backend (minimum:{' '}
          {entry.min_version}). Update to continue.
        </p>
        {entry.deprecation_notice && (
          <p className="max-w-[280px] text-xs text-text-muted">{entry.deprecation_notice}</p>
        )}
      </div>
      <button
        className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground shadow-[0_0_20px_rgba(0,0,0,0.15)] transition-colors hover:bg-primary-hover"
        onClick={onUpdate}
      >
        Update Actorium
      </button>
    </div>
  );
}
