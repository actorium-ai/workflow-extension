import { Code2, File, FileText, Folder, ListChecks, MessageSquarePlus, Rocket } from 'lucide-react';
import { type ComponentType, type ReactNode, useEffect, useState } from 'react';

import type { FeatureSummary, StorageDocument } from '../utils/types.ts';
import { LifecycleGlyph } from './status-glyph.tsx';

interface DocListProps {
  docs: StorageDocument[];
  features: FeatureSummary[];
  onOpenDocument: (doc: StorageDocument) => void;
  onInsertMention: (token: string) => void;
}

// Ported from digital-factory-ui's folder-tree-sidebar.tsx PATH_LABELS/
// PATH_ICONS — the canonical per-feature doc set every feature has.
const PATH_LABELS: Record<string, string> = {
  'product_spec.md': 'Product Spec',
  'tech_design.md': 'Technical Design',
  'tasks.md': 'Tasks',
  'handoff.md': 'Handoff',
};

const PATH_ICONS: Record<
  string,
  ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>
> = {
  'product_spec.md': FileText,
  'tech_design.md': Code2,
  'tasks.md': ListChecks,
  'handoff.md': Rocket,
};

interface TreeFolder {
  name: string;
  path: string;
  folders: TreeFolder[];
  files: StorageDocument[];
}

interface ContextMenuState {
  doc: StorageDocument;
  x: number;
  y: number;
}

function basenameOf(path: string): string {
  return path.split('/').pop() ?? path;
}

function labelForDoc(doc: StorageDocument): string {
  const basename = basenameOf(doc.path);
  return doc.title || PATH_LABELS[basename] || basename;
}

/** Canonical `<d:slug/relativePath>` mention tag for this doc — used by both
 * drag-and-drop (dataTransfer payload) and the right-click menu's "Append to
 * chat" action. The slug prefix disambiguates same-named files across
 * features (every feature has its own tasks.md) and lets panel.ts's
 * _resolveMentions rewrite it to the feature's UUID before send. A
 * workspace-root doc (no owning feature) uses the reserved "_workspace"
 * slug + its full workspace-relative path instead. */
function mentionTokenForDoc(doc: StorageDocument, featureSlug?: string): string {
  if (featureSlug && doc.feature_id) {
    const segments = doc.path.split('/');
    const idx = segments.findIndex((s) => s === featureSlug || s === doc.feature_id);
    const relativePath = idx !== -1 ? segments.slice(idx + 1).join('/') : basenameOf(doc.path);
    return `<d:${featureSlug}/${relativePath}>`;
  }
  return `<d:_workspace/${doc.path}>`;
}

function buildTree(docs: StorageDocument[]): TreeFolder {
  const root: TreeFolder = { name: '', path: '', folders: [], files: [] };

  function ensureFolder(path: string): TreeFolder {
    if (!path) return root;
    let node = root;
    for (const segment of path.split('/').filter(Boolean)) {
      const childPath = node.path ? `${node.path}/${segment}` : segment;
      let child = node.folders.find((f) => f.name === segment);
      if (!child) {
        child = { name: segment, path: childPath, folders: [], files: [] };
        node.folders.push(child);
      }
      node = child;
    }
    return node;
  }

  for (const doc of docs) {
    const segments = doc.path.split('/').filter(Boolean);
    const parentPath = segments.slice(0, -1).join('/');
    ensureFolder(parentPath).files.push(doc);
  }

  function sortTree(folder: TreeFolder): void {
    folder.folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    folder.files.sort((a, b) =>
      labelForDoc(a).localeCompare(labelForDoc(b), undefined, { sensitivity: 'base' }),
    );
    folder.folders.forEach(sortTree);
  }
  sortTree(root);
  return root;
}

/** Maps each feature to the one folder path in the tree that's "its" root —
 * the first path segment (across all docs) matching the feature's own name
 * or id, mirroring digital-factory-ui's featureRootCandidates/
 * primaryFeatureRoot (simplified to a single root per feature, since a
 * feature's docs splitting across two physical roots is a rare edge case
 * there anyway). */
function computeFeatureRoots(
  docs: StorageDocument[],
  features: FeatureSummary[],
): Map<string, FeatureSummary> {
  const roots = new Map<string, FeatureSummary>();
  for (const feature of features) {
    for (const doc of docs) {
      const segments = doc.path.split('/');
      const idx = segments.findIndex((s) => s === feature.feature_name || s === feature.id);
      if (idx !== -1) {
        roots.set(segments.slice(0, idx + 1).join('/'), feature);
        break;
      }
    }
  }
  return roots;
}

function DocRow({
  doc,
  featureNameById,
  onOpenDocument,
  onContextMenu,
}: {
  doc: StorageDocument;
  featureNameById: Map<string, string>;
  onOpenDocument: (doc: StorageDocument) => void;
  onContextMenu: (doc: StorageDocument, x: number, y: number) => void;
}) {
  const basename = basenameOf(doc.path);
  const Icon = PATH_ICONS[basename] ?? File;
  return (
    <button
      type="button"
      title={doc.path}
      draggable
      onDragStart={(e) => {
        const featureSlug = doc.feature_id ? featureNameById.get(doc.feature_id) : undefined;
        e.dataTransfer.setData('text/plain', mentionTokenForDoc(doc, featureSlug));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => onOpenDocument(doc)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(doc, e.clientX, e.clientY);
      }}
      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-secondary"
    >
      {/* Fixed-width spacer matching Chevron's footprint below, so a file
          row's icon lines up under a sibling folder row's icon rather than
          starting further left where folders have no chevron. */}
      <span className="inline-block w-3 shrink-0" aria-hidden="true" />
      <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
        {labelForDoc(doc)}
      </span>
    </button>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span
      className={
        'inline-flex w-3 shrink-0 justify-center text-text-muted transition-transform' +
        (open ? ' rotate-90' : '')
      }
      aria-hidden="true"
    >
      ›
    </span>
  );
}

function FolderContents({
  folder,
  featureRoots,
  featureNameById,
  onOpenDocument,
  onContextMenu,
}: {
  folder: TreeFolder;
  featureRoots: Map<string, FeatureSummary>;
  featureNameById: Map<string, string>;
  onOpenDocument: (doc: StorageDocument) => void;
  onContextMenu: (doc: StorageDocument, x: number, y: number) => void;
}) {
  return (
    <>
      {folder.folders.map((f) => (
        <FolderNode
          key={f.path}
          folder={f}
          featureRoots={featureRoots}
          featureNameById={featureNameById}
          onOpenDocument={onOpenDocument}
          onContextMenu={onContextMenu}
        />
      ))}
      {folder.files.map((d) => (
        <DocRow
          key={d.id}
          doc={d}
          featureNameById={featureNameById}
          onOpenDocument={onOpenDocument}
          onContextMenu={onContextMenu}
        />
      ))}
    </>
  );
}

/** One folder in the tree — renders as a feature group (lifecycle glyph +
 * feature name) when its path is a known feature root, otherwise as a plain
 * structural folder (generic folder icon). Either way, its children recurse
 * through the same check, so a feature's own subfolders (e.g. "handoffs")
 * render as plain folders nested inside the feature group. */
function FolderNode({
  folder,
  featureRoots,
  featureNameById,
  onOpenDocument,
  onContextMenu,
}: {
  folder: TreeFolder;
  featureRoots: Map<string, FeatureSummary>;
  featureNameById: Map<string, string>;
  onOpenDocument: (doc: StorageDocument) => void;
  onContextMenu: (doc: StorageDocument, x: number, y: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const feature = featureRoots.get(folder.path);

  const label: ReactNode = feature ? (
    <>
      <LifecycleGlyph stage={feature.status} />
      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-text-primary lowercase">
        {feature.feature_name || feature.title || feature.id}
      </span>
    </>
  ) : (
    <>
      <Folder className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">{folder.name}</span>
    </>
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-secondary"
      >
        <Chevron open={open} />
        {label}
      </button>
      {open && (
        <div className="mt-0.5 ml-3 border-l border-border pl-2">
          <FolderContents
            folder={folder}
            featureRoots={featureRoots}
            featureNameById={featureNameById}
            onOpenDocument={onOpenDocument}
            onContextMenu={onContextMenu}
          />
        </div>
      )}
    </div>
  );
}

/** Right-click menu for a doc row — "Open" (same as left-click) and "Append
 * to chat" (inserts the same "#<label>" mention token dragging the row into
 * the chat input would). Fixed-position, closes on outside click/Escape,
 * mirroring digital-factory-ui's FolderContextMenu. */
function DocContextMenu({
  state,
  onOpen,
  onAppendToChat,
  onClose,
}: {
  state: ContextMenuState;
  onOpen: (doc: StorageDocument) => void;
  onAppendToChat: (doc: StorageDocument) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={onClose} />
      <div
        role="menu"
        style={{ top: state.y, left: state.x }}
        className="fixed z-50 w-40 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-2xl"
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onOpen(state.doc);
            onClose();
          }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
        >
          <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Open
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onAppendToChat(state.doc);
            onClose();
          }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
        >
          <MessageSquarePlus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Append to chat
        </button>
      </div>
    </>
  );
}

export function DocList({ docs, features, onOpenDocument, onInsertMention }: DocListProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  if (docs.length === 0) {
    return <div className="px-3 py-3 text-center text-xs text-text-muted">No documents yet.</div>;
  }

  const tree = buildTree(docs);
  const featureRoots = computeFeatureRoots(docs, features);
  const featureNameById = new Map(features.map((f) => [f.id, f.feature_name || f.title || f.id]));

  return (
    <div className="px-1">
      <FolderContents
        folder={tree}
        featureRoots={featureRoots}
        featureNameById={featureNameById}
        onOpenDocument={onOpenDocument}
        onContextMenu={(doc, x, y) => setContextMenu({ doc, x, y })}
      />
      {contextMenu && (
        <DocContextMenu
          state={contextMenu}
          onOpen={onOpenDocument}
          onAppendToChat={(doc) =>
            onInsertMention(
              mentionTokenForDoc(
                doc,
                doc.feature_id ? featureNameById.get(doc.feature_id) : undefined,
              ),
            )
          }
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
