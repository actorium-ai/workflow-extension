import { useId } from 'react';

/**
 * Actorium's "North Star" mark — two four-point stars meeting at a single
 * gate: the agent (Signal Blue, rising) and the human (Human Silver,
 * grounded). Exact path/gradient/badge data ported from digital-factory-ui's
 * LogoMark (src/components/ui/logo.tsx). Per brand kit, the mark always sits
 * on its dark badge (#1c1e23), even on a light VS Code theme, so the badge
 * and center-dot fill are literal hex, not theme tokens — don't restyle
 * without checking the brand kit first.
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
        <linearGradient id={agentGradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4f9df3" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
        <linearGradient id={humanGradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e2e6ee" />
          <stop offset="1" stopColor="#7fb8f7" />
        </linearGradient>
      </defs>
      <rect width="200" height="200" rx="44" fill="#1c1e23" />
      <path
        d="M100 24 Q111 84 170 104 Q122 119 100 100 Q78 119 30 104 Q89 84 100 24 Z"
        fill={`url(#${agentGradientId})`}
      />
      <path
        d="M100 184 Q89 134 45 116 Q93 109 100 100 Q107 109 155 116 Q111 134 100 184 Z"
        fill={`url(#${humanGradientId})`}
        opacity="0.95"
      />
      <circle cx="100" cy="104" r="9" fill="#1c1e23" />
      <circle cx="100" cy="104" r="4.5" fill="#e2e6ee" />
    </svg>
  );
}
