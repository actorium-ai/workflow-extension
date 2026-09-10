import { Code2, GitPullRequest, Search } from 'lucide-react';

import { ActoriumLogo } from './actorium-logo';

interface AuthPromptProps {
  visible: boolean;
  onConnect: () => void;
  /** Which backend this window is currently scoped to (e.g. "staging", or a
   * raw custom bffUrl) — named in the copy so landing here after picking a
   * custom/non-Production server (via "Select custom server…" or the
   * advanced actorium.bffUrl override) reads as "you're on the right
   * backend, you just have no account here yet" rather than generic,
   * backend-agnostic copy. Omitted (or "Production") shows the original
   * copy unchanged, keeping the common case exactly as it was. */
  environmentLabel?: string | null;
}

const HIGHLIGHTS = [
  { icon: Code2, label: 'Read, write, and refactor code across your repos' },
  { icon: Search, label: 'Explore call graphs and symbols with GitNexus' },
  { icon: GitPullRequest, label: 'Open branches, commit, and post PRs' },
];

export function AuthPrompt({ visible, onConnect, environmentLabel }: AuthPromptProps) {
  const showEnvironment = !!environmentLabel && environmentLabel !== 'Production';
  return (
    <div
      className={
        (visible ? 'flex' : 'hidden') +
        ' h-full flex-col items-center justify-center gap-5 p-6 text-center'
      }
    >
      <div
        className="flex items-center justify-center rounded-full p-5"
        style={{
          background: 'radial-gradient(circle, rgba(79,157,243,0.16) 0%, rgba(79,157,243,0) 72%)',
        }}
      >
        <ActoriumLogo size={64} />
      </div>
      <div className="space-y-1.5">
        <h3 className="text-base font-semibold text-text-primary">Actorium Agent</h3>
        <p className="max-w-[260px] text-sm text-text-secondary">
          {showEnvironment
            ? `Connect your ${environmentLabel} account to start pair programming with AI, right inside your editor.`
            : 'Connect your account to start pair programming with AI, right inside your editor.'}
        </p>
      </div>
      <button
        className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground shadow-[0_0_20px_rgba(0,0,0,0.15)] transition-colors hover:bg-primary-hover"
        onClick={onConnect}
      >
        Connect to Actorium
      </button>
      <ul className="mt-1 flex w-full max-w-[280px] flex-col gap-2 border-t border-border pt-4 text-left">
        {HIGHLIGHTS.map(({ icon: Icon, label }) => (
          <li key={label} className="flex items-start gap-2 text-xs text-text-muted">
            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
