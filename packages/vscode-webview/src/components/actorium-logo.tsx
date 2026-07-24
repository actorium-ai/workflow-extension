import { useId } from 'react';

/**
 * Actorium's "North Star" mark — two four-point stars meeting at a single
 * gate: the agent (Signal Blue, rising) and the human (Human Silver,
 * grounded). Exact path/gradient data from the official brand kit's
 * "Primary mark — dark" variant — not a placeholder, don't restyle the
 * paths/colors without checking the brand kit first.
 *
 * Gradient ids are scoped per-instance via useId() — this component can be
 * mounted more than once at a time in the DOM (e.g. AuthPrompt and
 * MessageList's empty state are both always-mounted, toggled by a CSS
 * `hidden` class rather than unmounting), and SVG <defs> ids are global to
 * the document, so a static id would collide across instances.
 */
export function ActoriumLogo({ size = 40, className = '' }: { size?: number; className?: string }) {
  const uid = useId();
  const agentGradientId = `actorium-agent-${uid}`;
  const humanGradientId = `actorium-human-${uid}`;

  return (
    <svg width={size} height={size} viewBox="0 0 200 200" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={humanGradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e2e6ee" />
          <stop offset="1" stopColor="#7fb8f7" />
        </linearGradient>
        <linearGradient id={agentGradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4f9df3" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <path
        d="M100 14 Q112 80 176 102 Q124 118 100 98 Q76 118 24 102 Q88 80 100 14 Z"
        fill={`url(#${agentGradientId})`}
      />
      <path
        d="M100 190 Q88 132 40 112 Q92 106 100 96 Q108 106 160 112 Q112 132 100 190 Z"
        fill={`url(#${humanGradientId})`}
        opacity="0.95"
      />
      <circle cx="100" cy="102" r="9" fill="var(--color-bg)" />
      <circle cx="100" cy="102" r="4.5" fill="#e2e6ee" />
    </svg>
  );
}
