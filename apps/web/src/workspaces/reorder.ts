/**
 * The rows a drag carries: every ticked row when the dragged one is ticked,
 * otherwise just the dragged row. Returned in list order so a block keeps its
 * internal order wherever it lands.
 */
export function movingBlock<T>(
  order: readonly T[],
  selected: ReadonlySet<T>,
  dragged: T,
): T[] {
  return selected.has(dragged)
    ? order.filter((item) => selected.has(item))
    : [dragged];
}

/**
 * Whether a block dragged by `anchor` lands after `target` (dragging down) or
 * before it (dragging up). The drop indicator is drawn from the same answer.
 */
export function landsAfter<T>(order: readonly T[], anchor: T, target: T) {
  return order.indexOf(anchor) < order.indexOf(target);
}

/**
 * Moves `moving` next to `target`. Returns the same array when nothing would
 * change, so callers can skip the save.
 */
export function moveBlock<T>(
  order: readonly T[],
  moving: readonly T[],
  anchor: T,
  target: T,
): readonly T[] {
  if (moving.length === 0 || moving.includes(target)) return order;
  if (!order.includes(target) || !order.includes(anchor)) return order;
  const rest = order.filter((item) => !moving.includes(item));
  const at = rest.indexOf(target) + (landsAfter(order, anchor, target) ? 1 : 0);
  return unchangedOr(order, [
    ...rest.slice(0, at),
    ...moving,
    ...rest.slice(at),
  ]);
}

/**
 * Moves `moving` so its first row sits at the 1-based `position`. Positions
 * past either end are clamped.
 */
export function moveBlockToPosition<T>(
  order: readonly T[],
  moving: readonly T[],
  position: number,
): readonly T[] {
  if (moving.length === 0 || !Number.isFinite(position)) return order;
  const rest = order.filter((item) => !moving.includes(item));
  const at = Math.min(Math.max(Math.trunc(position) - 1, 0), rest.length);
  return unchangedOr(order, [
    ...rest.slice(0, at),
    ...moving,
    ...rest.slice(at),
  ]);
}

/**
 * Applies a new order for a filtered view to the full list. The slots the
 * view's rows occupy are refilled in the view's new order; rows outside the
 * view keep their places.
 */
export function replaceSlots<T>(
  order: readonly T[],
  nextView: readonly T[],
): readonly T[] {
  const inView = new Set(nextView);
  let slot = 0;
  return unchangedOr(
    order,
    order.map((item) => (inView.has(item) ? (nextView[slot++] as T) : item)),
  );
}

function unchangedOr<T>(order: readonly T[], next: T[]): readonly T[] {
  return next.length === order.length &&
    next.every((item, index) => item === order[index])
    ? order
    : next;
}
