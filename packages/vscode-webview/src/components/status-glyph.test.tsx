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

  it('titles the glyph with the status label so it is inspectable in the UI', () => {
    const { container } = render(<LifecycleGlyph stage="preparing_handoff" />);
    const span = container.querySelector('span[title="Preparing Handoff"]');
    expect(span).not.toBeNull();
  });
});
