/**
 * Renders a unified diff patch (see FileOps.editFile/writeFile's
 * createPatch call) as a lightweight colored diff — replaces the raw JSON
 * dump previously shown when expanding a completed edit_file/write_file
 * call. The `Index:`/`===`/`---`/`+++` preamble createPatch emits is dropped
 * since the file path is already shown in the tool call's own label right
 * above; so are the `@@ ... @@` hunk header and `\ No newline at end of
 * file` marker lines — both are diff-tool bookkeeping with nothing a reader
 * needs. Each added/removed/context line gets a dedicated +/-/space gutter
 * column instead of leaving that character inline in the text, GitHub-diff
 * style.
 */
export function DiffView({ patch }: { patch: string }) {
  const lines = patch
    .split('\n')
    .filter(
      (line) =>
        !line.startsWith('Index:') &&
        !line.startsWith('===') &&
        !line.startsWith('--- ') &&
        !line.startsWith('+++ ') &&
        !line.startsWith('@@') &&
        !line.startsWith('\\ No newline'),
    );

  return (
    <div className="mt-0.5 max-h-56 overflow-auto rounded-md bg-code-bg font-mono text-[11.5px] leading-relaxed">
      {lines.map((line, i) => {
        const isAdded = line.startsWith('+');
        const isRemoved = line.startsWith('-');
        const content = isAdded || isRemoved ? line.slice(1) : line;

        return (
          <div
            key={i}
            className={'flex' + (isAdded ? ' bg-success/15' : isRemoved ? ' bg-danger/15' : '')}
          >
            <span
              aria-hidden="true"
              className={
                'w-4 shrink-0 select-none text-center' +
                (isAdded ? ' text-success' : isRemoved ? ' text-danger' : ' text-transparent')
              }
            >
              {isAdded ? '+' : isRemoved ? '−' : ' '}
            </span>
            <span
              className={
                'min-w-0 flex-1 whitespace-pre-wrap break-words pr-2' +
                (isAdded ? ' text-success' : isRemoved ? ' text-danger' : ' text-text-secondary')
              }
            >
              {content}
            </span>
          </div>
        );
      })}
    </div>
  );
}
