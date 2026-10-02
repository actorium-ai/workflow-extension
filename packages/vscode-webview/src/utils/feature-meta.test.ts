import { describe, expect, it } from 'vitest';

import {
  boardColumnFor,
  lifecycleMeta,
  NO_COLUMN_STATUSES,
  STATUS_ORDER,
  statusSortIndex,
} from './feature-meta.ts';

describe('lifecycleMeta', () => {
  it('returns the Preparing Handoff label and preparing color token', () => {
    expect(lifecycleMeta('preparing_handoff')).toEqual({
      label: 'Preparing Handoff',
      color: 'var(--color-preparing)',
    });
  });

  it('returns the Handoff Blocked label and danger color token', () => {
    expect(lifecycleMeta('handoff_blocked')).toEqual({
      label: 'Handoff Blocked',
      color: 'var(--color-danger)',
    });
  });
});

describe('finalization statuses', () => {
  it('returns the Finalizing label with the finalizing token', () => {
    expect(lifecycleMeta('in_finalization')).toEqual({
      label: 'Finalizing',
      color: 'var(--color-finalizing)',
    });
  });

  it('returns the Finalization Blocked label with the danger token', () => {
    expect(lifecycleMeta('finalization_blocked')).toEqual({
      label: 'Finalization Blocked',
      color: 'var(--color-danger)',
    });
  });

  it('orders finalization_blocked, in_finalization ahead of in_handoff', () => {
    expect(STATUS_ORDER.indexOf('finalization_blocked')).toBeLessThan(
      STATUS_ORDER.indexOf('in_finalization'),
    );
    expect(STATUS_ORDER.indexOf('in_finalization')).toBeLessThan(
      STATUS_ORDER.indexOf('in_handoff'),
    );
  });
});

describe('STATUS_ORDER', () => {
  it('places preparing_handoff and handoff_blocked between in_handoff and in_implementation', () => {
    const inHandoff = STATUS_ORDER.indexOf('in_handoff');
    const handoffBlocked = STATUS_ORDER.indexOf('handoff_blocked');
    const preparingHandoff = STATUS_ORDER.indexOf('preparing_handoff');
    const inImplementation = STATUS_ORDER.indexOf('in_implementation');

    expect(inHandoff).toBeLessThan(handoffBlocked);
    expect(handoffBlocked).toBeLessThan(preparingHandoff);
    expect(preparingHandoff).toBeLessThan(inImplementation);
  });

  it('sorts handoff_blocked ahead of preparing_handoff in statusSortIndex', () => {
    expect(statusSortIndex('handoff_blocked')).toBeLessThan(statusSortIndex('preparing_handoff'));
  });
});

describe('boardColumnFor', () => {
  it('folds handoff_blocked into the preparing_handoff column', () => {
    expect(boardColumnFor('handoff_blocked')).toBe('preparing_handoff');
  });

  it('folds finalization_blocked into the in_finalization column', () => {
    expect(boardColumnFor('finalization_blocked')).toBe('in_finalization');
  });

  it('leaves every other status unchanged', () => {
    for (const status of STATUS_ORDER) {
      if (NO_COLUMN_STATUSES.has(status)) continue;
      expect(boardColumnFor(status)).toBe(status);
    }
  });
});
