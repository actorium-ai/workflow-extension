import { AtSign, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { lifecycleMeta, statusSortIndex, tint } from '../utils/feature-meta.ts';
import type { FeatureSummary } from '../utils/types.ts';
import { LifecycleGlyph } from './status-glyph.tsx';

function matchesQuery(feature: FeatureSummary, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    (feature.feature_name || '').toLowerCase().includes(q) ||
    (feature.title || '').toLowerCase().includes(q) ||
    feature.id.toLowerCase().includes(q)
  );
}

interface FeatureListProps {
  features: FeatureSummary[];
  /** Opens the feature-detail editor tab (Product Spec/Tech Design/Tasks/
   * Handoff/Activity) — see NavigatorPanelProvider's openFeatureDetail
   * handler and FeatureDetailPanel. */
  onOpenFeatureDetail: (feature: FeatureSummary) => void;
  /** Inserts a plain-text reference to a feature into the active terminal
   * (or clipboard, if none) — see NavigatorPanelProvider's tagInPrompt
   * handler. The text is picked up by whatever coding agent CLI the user is
   * mid-typing a prompt to; it isn't a structured mention, just a hint the
   * agent can resolve with its own MCP tools (get_feature by name, etc). */
  onTagInPrompt: (text: string) => void;
}

function featureTag(feature: FeatureSummary): string {
  return `feature "${feature.feature_name || feature.title || feature.id}"`;
}

function FeatureRow({
  feature,
  onOpenFeatureDetail,
  onTagInPrompt,
}: {
  feature: FeatureSummary;
  onOpenFeatureDetail: (feature: FeatureSummary) => void;
  onTagInPrompt: (text: string) => void;
}) {
  return (
    <div className="group flex w-full items-center gap-1 rounded-md pr-1 hover:bg-surface-secondary">
      <button
        type="button"
        title={feature.next_action || feature.current_stage}
        onClick={() => onOpenFeatureDetail(feature)}
        className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left"
      >
        <LifecycleGlyph stage={feature.status} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">
          {feature.feature_name || feature.title || feature.id}
        </span>
      </button>
      <button
        type="button"
        title="Tag this feature in the terminal prompt"
        onClick={() => onTagInPrompt(featureTag(feature))}
        className="shrink-0 rounded p-1 text-text-muted opacity-0 hover:bg-surface-secondary hover:text-text-primary group-hover:opacity-100"
      >
        <AtSign className="h-3 w-3 shrink-0" aria-hidden="true" />
      </button>
    </div>
  );
}

function FeatureGroup({
  status,
  features,
  onOpenFeatureDetail,
  onTagInPrompt,
}: {
  status: string;
  features: FeatureSummary[];
  onOpenFeatureDetail: (feature: FeatureSummary) => void;
  onTagInPrompt: (text: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const meta = lifecycleMeta(status);

  return (
    <div className="mt-2 first:mt-0">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-surface-secondary"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 shrink-0 text-text-muted" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0 text-text-muted" aria-hidden="true" />
        )}
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ color: meta.color, background: tint(meta.color) }}
        >
          {meta.label}
        </span>
        <span className="text-[10px] text-text-muted">
          {features.length} {features.length === 1 ? 'feature' : 'features'}
        </span>
      </button>
      {!collapsed &&
        features.map((f) => (
          <FeatureRow
            key={f.id}
            feature={f}
            onOpenFeatureDetail={onOpenFeatureDetail}
            onTagInPrompt={onTagInPrompt}
          />
        ))}
    </div>
  );
}

export function FeatureList({ features, onOpenFeatureDetail, onTagInPrompt }: FeatureListProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => features.filter((f) => matchesQuery(f, query)), [features, query]);

  const orderedGroups = useMemo(() => {
    const groups = new Map<string, FeatureSummary[]>();
    for (const f of filtered) {
      const list = groups.get(f.status) ?? [];
      list.push(f);
      groups.set(f.status, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => statusSortIndex(a) - statusSortIndex(b));
  }, [filtered]);

  if (features.length === 0) {
    return <div className="px-3 py-3 text-center text-xs text-text-muted">No features yet.</div>;
  }

  return (
    <div className="px-1">
      <div className="mb-1 flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 mx-1">
        <Search className="h-3 w-3 shrink-0 text-text-muted" aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search features…"
          className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted"
        />
      </div>
      {orderedGroups.length === 0 ? (
        <div className="px-3 py-3 text-center text-xs text-text-muted">No matching features.</div>
      ) : (
        orderedGroups.map(([status, groupFeatures]) => (
          <FeatureGroup
            key={status}
            status={status}
            features={groupFeatures}
            onOpenFeatureDetail={onOpenFeatureDetail}
            onTagInPrompt={onTagInPrompt}
          />
        ))
      )}
    </div>
  );
}
