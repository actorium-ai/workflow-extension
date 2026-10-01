import { render, screen, within } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { FeaturesBrowser } from './features-browser.tsx';
import type { FeatureSummary } from './utils/types.ts';

function feature(overrides: Partial<FeatureSummary>): FeatureSummary {
  return {
    id: overrides.id ?? 'f1',
    feature_name: overrides.feature_name ?? 'feature-one',
    title: 'Feature One',
    status: 'in_implementation',
    current_stage: 'in_implementation',
    next_action: '',
    task_counts: { total: 0, done: 0, in_progress: 0, blocked: 0, ready: 0, todo: 0 },
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function loadFeatures(features: FeatureSummary[]) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', { data: { command: 'featuresLoaded', features, tasks: [] } }),
    );
  });
}

function switchToGridView() {
  const gridButton = screen.getByTitle('Grid view');
  act(() => gridButton.click());
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('FeaturesBrowser grid view', () => {
  it('has no Handoff Blocked column and shows a blocked feature inside Preparing Handoff with its red badge', () => {
    render(<FeaturesBrowser />);
    loadFeatures([
      feature({ id: 'blocked-1', feature_name: 'blocked-feature', status: 'handoff_blocked' }),
    ]);
    switchToGridView();

    // No "Handoff Blocked" column header should exist in the grid — only the
    // card badge inside it carries that text.
    const columnHeaders = Array.from(
      document.querySelectorAll('.flex.w-64 > .flex.items-center.gap-2.px-1'),
    );
    const headerLabels = columnHeaders.map((h) => h.textContent);
    expect(headerLabels.some((label) => label?.includes('Handoff Blocked'))).toBe(false);
    expect(headerLabels.some((label) => label?.includes('Preparing Handoff'))).toBe(true);

    // The card itself still carries the red "Handoff Blocked" badge, and it
    // sits inside the "Preparing Handoff" column.
    const preparingHeader = columnHeaders.find((h) => h.textContent?.includes('Preparing Handoff'));
    const column = preparingHeader?.closest('div.flex.w-64');
    expect(column).not.toBeNull();
    expect(within(column as HTMLElement).getByText('blocked-feature')).toBeTruthy();
    expect(within(column as HTMLElement).getByText('Handoff Blocked')).toBeTruthy();
  });

  it('includes handoff_blocked cards when the preparing_handoff chip is active', () => {
    render(<FeaturesBrowser />);
    loadFeatures([
      feature({ id: 'blocked-1', feature_name: 'blocked-feature', status: 'handoff_blocked' }),
    ]);
    switchToGridView();

    const chip = screen.getByRole('button', { name: /Preparing Handoff/ });
    act(() => chip.click());

    expect(screen.getByText('blocked-feature')).toBeTruthy();
  });
});

describe('FeaturesBrowser list view', () => {
  it('shows no empty Handoff Blocked group by default, but shows one while a feature is blocked', () => {
    render(<FeaturesBrowser />);
    loadFeatures([
      feature({ id: 'a', feature_name: 'plain-feature', status: 'in_implementation' }),
    ]);
    expect(screen.queryByText('Handoff Blocked')).toBeNull();

    loadFeatures([
      feature({ id: 'a', feature_name: 'plain-feature', status: 'in_implementation' }),
      feature({ id: 'b', feature_name: 'blocked-feature', status: 'handoff_blocked' }),
    ]);
    expect(screen.getAllByText('Handoff Blocked').length).toBeGreaterThan(0);
  });
});

describe('FeaturesBrowser checkout button', () => {
  it('shows the checkout affordance only for in_handoff, not preparing_handoff or handoff_blocked', () => {
    render(<FeaturesBrowser />);
    loadFeatures([
      feature({ id: 'h', feature_name: 'ready-for-review', status: 'in_handoff' }),
      feature({ id: 'p', feature_name: 'still-preparing', status: 'preparing_handoff' }),
      feature({ id: 'b', feature_name: 'blocked-feature', status: 'handoff_blocked' }),
    ]);

    expect(screen.getAllByTitle('Checkout PR for review')).toHaveLength(1);
  });
});
