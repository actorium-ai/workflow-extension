import {
  AtSign,
  Braces,
  Code2,
  Container,
  File,
  FileArchive,
  FileJson,
  FileText,
  Folder,
  GitBranch,
  Image as ImageIcon,
  Info,
  KeyRound,
  ListChecks,
  Rocket,
  ScrollText,
} from 'lucide-react';
import { type ComponentType, type ReactNode, useState } from 'react';

import type { FeatureSummary, StorageDocument } from '../utils/types.ts';
import { SectionState } from './section-state.tsx';
import { LifecycleGlyph } from './status-glyph.tsx';

interface DocListProps {
  docs: StorageDocument[];
  features: FeatureSummary[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onOpenDocument: (doc: StorageDocument) => void;
  /** Inserts a plain-text reference to a document into the active terminal
   * (or clipboard, if none) — see NavigatorPanelProvider's tagInPrompt
   * handler and FeatureList's matching onTagInPrompt. */
  onTagInPrompt: (text: string) => void;
}

function docTag(doc: StorageDocument): string {
  return `document "${doc.path}"`;
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

type FileStyle = {
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  color: string;
};

// Ported verbatim from digital-factory-ui's folder-tree-sidebar.tsx
// BASENAME_STYLES/EXTENSION_STYLES — per-file-type icon + color for any doc
// outside the 4 canonical ones above, which DocRow's plain fallback File
// icon used to flatten to one muted gray regardless of type.
const BASENAME_STYLES: Record<string, FileStyle> = {
  Dockerfile: { icon: Container, color: 'text-sky-400' },
  Makefile: { icon: FileText, color: 'text-red-400' },
  'README.md': { icon: Info, color: 'text-sky-300' },
  '.gitignore': { icon: GitBranch, color: 'text-orange-400' },
  'go.mod': { icon: Braces, color: 'text-cyan-400' },
  'go.sum': { icon: ScrollText, color: 'text-cyan-600' },
  'package.json': { icon: FileJson, color: 'text-yellow-400' },
  'LICENSE.md': { icon: KeyRound, color: 'text-yellow-500' },
  LICENSE: { icon: KeyRound, color: 'text-yellow-500' },
};

const EXTENSION_STYLES: Record<string, FileStyle> = {
  md: { icon: FileText, color: 'text-sky-300' },
  ts: { icon: Code2, color: 'text-blue-400' },
  tsx: { icon: Code2, color: 'text-blue-400' },
  js: { icon: Code2, color: 'text-yellow-400' },
  jsx: { icon: Code2, color: 'text-yellow-400' },
  go: { icon: Code2, color: 'text-cyan-400' },
  py: { icon: Code2, color: 'text-green-400' },
  json: { icon: FileJson, color: 'text-yellow-500' },
  yaml: { icon: Braces, color: 'text-purple-400' },
  yml: { icon: Braces, color: 'text-purple-400' },
  png: { icon: ImageIcon, color: 'text-purple-400' },
  jpg: { icon: ImageIcon, color: 'text-purple-400' },
  jpeg: { icon: ImageIcon, color: 'text-purple-400' },
  gif: { icon: ImageIcon, color: 'text-purple-400' },
  svg: { icon: ImageIcon, color: 'text-purple-400' },
  webp: { icon: ImageIcon, color: 'text-purple-400' },
  pdf: { icon: FileText, color: 'text-red-400' },
  zip: { icon: FileArchive, color: 'text-orange-400' },
  tar: { icon: FileArchive, color: 'text-orange-400' },
  gz: { icon: FileArchive, color: 'text-orange-400' },
};

function styleForBasename(basename: string): FileStyle {
  return (
    BASENAME_STYLES[basename] ??
    EXTENSION_STYLES[(basename.split('.').pop() ?? '').toLowerCase()] ?? {
      icon: File,
      color: 'text-text-muted',
    }
  );
}

interface TreeFolder {
  name: string;
  path: string;
  folders: TreeFolder[];
  files: StorageDocument[];
}

function basenameOf(path: string): string {
  return path.split('/').pop() ?? path;
}

function labelForDoc(doc: StorageDocument): string {
  const basename = basenameOf(doc.path);
  return doc.title || PATH_LABELS[basename] || basename;
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
  onOpenDocument,
  onTagInPrompt,
}: {
  doc: StorageDocument;
  onOpenDocument: (doc: StorageDocument) => void;
  onTagInPrompt: (text: string) => void;
}) {
  const basename = basenameOf(doc.path);
  const canonicalIcon = PATH_ICONS[basename];
  const style = canonicalIcon ? undefined : styleForBasename(basename);
  const Icon = canonicalIcon ?? style!.icon;
  return (
    <div className="group flex w-full items-center gap-1.5 rounded-md pr-1 hover:bg-surface-secondary">
      <button
        type="button"
        title={doc.path}
        onClick={() => onOpenDocument(doc)}
        className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left"
      >
        {/* Fixed-width spacer matching Chevron's footprint below, so a file
            row's icon lines up under a sibling folder row's icon rather than
            starting further left where folders have no chevron. */}
        <span className="inline-block w-3 shrink-0" aria-hidden="true" />
        <Icon
          className={`h-3.5 w-3.5 shrink-0 ${canonicalIcon ? 'text-text-muted' : style!.color}`}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
          {labelForDoc(doc)}
        </span>
      </button>
      <button
        type="button"
        title="Tag this document in the terminal prompt"
        onClick={() => onTagInPrompt(docTag(doc))}
        className="shrink-0 rounded p-1 text-text-muted opacity-0 hover:bg-surface-secondary hover:text-text-primary group-hover:opacity-100"
      >
        <AtSign className="h-3 w-3 shrink-0" aria-hidden="true" />
      </button>
    </div>
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
  onOpenDocument,
  onTagInPrompt,
}: {
  folder: TreeFolder;
  featureRoots: Map<string, FeatureSummary>;
  onOpenDocument: (doc: StorageDocument) => void;
  onTagInPrompt: (text: string) => void;
}) {
  return (
    <>
      {folder.folders.map((f) => (
        <FolderNode
          key={f.path}
          folder={f}
          featureRoots={featureRoots}
          onOpenDocument={onOpenDocument}
          onTagInPrompt={onTagInPrompt}
        />
      ))}
      {folder.files.map((d) => (
        <DocRow key={d.id} doc={d} onOpenDocument={onOpenDocument} onTagInPrompt={onTagInPrompt} />
      ))}
    </>
  );
}

/**
 * Walks down a chain of folders that each hold nothing but a single
 * subfolder (no files of their own) and combines them into one displayed
 * row — VS Code Explorer's "compact folders" behavior (on by default there:
 * `.claude` containing only `skills` renders as one row, ".claude / skills",
 * not two nested rows). Stops before absorbing a feature-root folder into
 * the chain (it needs its own distinct lifecycle-glyph row, not a plain
 * folder segment) or once a folder has files or more than one subfolder.
 */
function compactFolderChain(
  folder: TreeFolder,
  featureRoots: Map<string, FeatureSummary>,
): { names: string[]; folder: TreeFolder } {
  const names = [folder.name];
  let current = folder;
  while (
    current.files.length === 0 &&
    current.folders.length === 1 &&
    !featureRoots.has(current.folders[0].path)
  ) {
    current = current.folders[0];
    names.push(current.name);
  }
  return { names, folder: current };
}

/** One folder in the tree — renders as a feature group (lifecycle glyph +
 * feature name) when its path is a known feature root, otherwise as a plain
 * structural folder (generic folder icon), compacted with any single-child
 * subfolder chain beneath it (see compactFolderChain). Either way, its
 * children recurse through the same check, so a feature's own subfolders
 * (e.g. "handoffs") render as plain folders nested inside the feature
 * group. */
function FolderNode({
  folder,
  featureRoots,
  onOpenDocument,
  onTagInPrompt,
}: {
  folder: TreeFolder;
  featureRoots: Map<string, FeatureSummary>;
  onOpenDocument: (doc: StorageDocument) => void;
  onTagInPrompt: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const feature = featureRoots.get(folder.path);
  const { names, folder: target } = feature
    ? { names: [folder.name], folder }
    : compactFolderChain(folder, featureRoots);

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
      <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
        {names.join(' / ')}
      </span>
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
            folder={target}
            featureRoots={featureRoots}
            onOpenDocument={onOpenDocument}
            onTagInPrompt={onTagInPrompt}
          />
        </div>
      )}
    </div>
  );
}

export function DocList({
  docs,
  features,
  loading,
  error,
  onRetry,
  onOpenDocument,
  onTagInPrompt,
}: DocListProps) {
  if (docs.length === 0) {
    if (error) {
      return <SectionState kind="error" message="Couldn't load documents." onRetry={onRetry} />;
    }
    if (loading) {
      return <SectionState kind="loading" message="Loading documents…" />;
    }
    return <SectionState kind="empty" message="No documents yet." />;
  }

  const tree = buildTree(docs);
  const featureRoots = computeFeatureRoots(docs, features);

  return (
    <div className="px-1">
      <FolderContents
        folder={tree}
        featureRoots={featureRoots}
        onOpenDocument={onOpenDocument}
        onTagInPrompt={onTagInPrompt}
      />
    </div>
  );
}
