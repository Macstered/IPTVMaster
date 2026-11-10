import { describe, expect, it } from 'vitest';

import {
  landsAfter,
  moveBlock,
  moveBlockToPosition,
  movingBlock,
  replaceSlots,
} from './reorder.js';

const order = ['a', 'b', 'c', 'd', 'e', 'f'];

describe('movingBlock', () => {
  it('carries only the dragged row when it is not ticked', () => {
    expect(movingBlock(order, new Set(['b', 'd']), 'e')).toEqual(['e']);
  });

  it('carries every ticked row, in list order, when the dragged row is ticked', () => {
    expect(movingBlock(order, new Set(['e', 'b']), 'e')).toEqual(['b', 'e']);
  });
});

describe('moveBlock', () => {
  it('lands after the target when dragged down', () => {
    expect(landsAfter(order, 'b', 'd')).toBe(true);
    expect(moveBlock(order, ['b'], 'b', 'd')).toEqual([
      'a',
      'c',
      'd',
      'b',
      'e',
      'f',
    ]);
  });

  it('lands before the target when dragged up', () => {
    expect(landsAfter(order, 'e', 'b')).toBe(false);
    expect(moveBlock(order, ['e'], 'e', 'b')).toEqual([
      'a',
      'e',
      'b',
      'c',
      'd',
      'f',
    ]);
  });

  it('moves scattered rows together and keeps their relative order', () => {
    expect(moveBlock(order, ['a', 'c', 'e'], 'c', 'f')).toEqual([
      'b',
      'd',
      'f',
      'a',
      'c',
      'e',
    ]);
    expect(moveBlock(order, ['c', 'e', 'f'], 'e', 'a')).toEqual([
      'c',
      'e',
      'f',
      'a',
      'b',
      'd',
    ]);
  });

  it('can reach both ends of the list', () => {
    expect(moveBlock(order, ['c'], 'c', 'a')[0]).toBe('c');
    expect(moveBlock(order, ['c'], 'c', 'f').at(-1)).toBe('c');
  });

  it('returns the same array when nothing would change', () => {
    expect(moveBlock(order, ['b', 'c'], 'b', 'c')).toBe(order);
    expect(moveBlock(order, ['b'], 'b', 'a')).not.toBe(order);
    expect(moveBlock(order, ['a'], 'a', 'missing')).toBe(order);
    expect(moveBlock(order, [], 'a', 'b')).toBe(order);
  });
});

describe('replaceSlots', () => {
  it('reorders the rows of a view and leaves the rest in place', () => {
    // The view shows b, d and f; moving f to the top of that view must not
    // disturb a, c or e.
    expect(replaceSlots(order, ['f', 'b', 'd'])).toEqual([
      'a',
      'f',
      'c',
      'b',
      'e',
      'd',
    ]);
  });

  it('returns the same array when the view order did not change', () => {
    expect(replaceSlots(order, ['b', 'd', 'f'])).toBe(order);
  });
});

describe('moveBlockToPosition', () => {
  it('puts the first moved row at the 1-based position', () => {
    expect(moveBlockToPosition(order, ['e'], 2)).toEqual([
      'a',
      'e',
      'b',
      'c',
      'd',
      'f',
    ]);
    expect(moveBlockToPosition(order, ['b', 'd'], 1)).toEqual([
      'b',
      'd',
      'a',
      'c',
      'e',
      'f',
    ]);
  });

  it('clamps positions past either end', () => {
    expect(moveBlockToPosition(order, ['a'], 99).at(-1)).toBe('a');
    expect(moveBlockToPosition(order, ['f'], -3)[0]).toBe('f');
  });

  it('returns the same array when nothing would change', () => {
    expect(moveBlockToPosition(order, ['a'], 1)).toBe(order);
    expect(moveBlockToPosition(order, ['a'], Number.NaN)).toBe(order);
  });
});
