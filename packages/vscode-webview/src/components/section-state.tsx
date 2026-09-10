import { Loader2, RotateCw, TriangleAlert } from 'lucide-react';

/**
 * Shared loading/empty/error placeholder for a Navigator section (Docs,
 * Features, ...). Before this, a fetch that failed (no token, non-2xx,
 * network error) and a genuinely empty workspace both rendered the SAME
 * plain "No X yet." text — see workflow-api.ts's SectionResult and panel.ts's
 * _loadDocs/_loadFeatures for where the distinction is actually computed.
 */
export function SectionState({
  kind,
  message,
  onRetry,
}: {
  kind: 'loading' | 'empty' | 'error';
  message: string;
  onRetry?: () => void;
}) {
  if (kind === 'loading') {
    return (
      <div className="flex items-center justify-center gap-1.5 px-3 py-3 text-xs text-text-muted">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
        {message}
      </div>
    );
  }

  if (kind === 'error') {
    return (
      <div className="flex flex-col items-center gap-1.5 px-3 py-3 text-center text-xs">
        <span className="flex items-center gap-1.5 text-danger">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {message}
        </span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
          >
            <RotateCw className="h-3 w-3 shrink-0" aria-hidden="true" />
            Retry
          </button>
        )}
      </div>
    );
  }

  return <div className="px-3 py-3 text-center text-xs text-text-muted">{message}</div>;
}
