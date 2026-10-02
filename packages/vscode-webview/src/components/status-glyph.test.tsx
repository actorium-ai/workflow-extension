import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LifecycleGlyph } from './status-glyph.tsx';

describe('LifecycleGlyph', () => {
  it('renders the circle-ellipsis icon for preparing_handoff', () => {
    const { container } = render(<LifecycleGlyph stage="preparing_handoff" />);
    expect(container.querySelector('svg.lucide-circle-ellipsis')).not.toBeNull();
  });

  it('renders the circle-x icon for handoff_blocked, same as blocked', () => {
    const { container: blocked } = render(<LifecycleGlyph stage="handoff_blocked" />);
    const { container: alsoBlocked } = render(<LifecycleGlyph stage="blocked" />);
    expect(blocked.querySelector('svg.lucide-circle-x')).not.toBeNull();
    expect(alsoBlocked.querySelector('svg.lucide-circle-x')).not.toBeNull();
  });

  it('renders the custom flag glyph for in_finalization, in the finalizing colour', () => {
    const { container } = render(<LifecycleGlyph stage="in_finalization" />);
    const svg = container.querySelector('span[title="Finalizing"] svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('stroke')).toBe('var(--color-finalizing)');
    expect(svg?.querySelectorAll('path')).toHaveLength(2);
  });

  it('renders the circle-x icon for finalization_blocked', () => {
    const { container } = render(<LifecycleGlyph stage="finalization_blocked" />);
    expect(
      container.querySelector('span[title="Finalization Blocked"] svg.lucide-circle-x'),
    ).not.toBeNull();
  });

  it('titles the glyph with the status label so it is inspectable in the UI', () => {
    const { container } = render(<LifecycleGlyph stage="preparing_handoff" />);
    const span = container.querySelector('span[title="Preparing Handoff"]');
    expect(span).not.toBeNull();
  });
});
