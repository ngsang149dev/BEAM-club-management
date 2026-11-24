import { badRequest } from '@/lib/errors';

export const POSITION_STEP = 1000;
export const MIN_POSITION_GAP = 0.001;

export interface OrderedMoveSibling {
  readonly id: string;
  readonly position: number;
  readonly visibleToActor: boolean;
}

export interface ComputeTaskMovePlanParams {
  readonly targetTaskId: string;
  readonly currentColumnId: string | null;
  readonly currentPosition: number;
  readonly destinationColumnId: string;
  readonly orderedSiblings: readonly OrderedMoveSibling[];
  readonly beforeId?: string | null;
  readonly afterId?: string | null;
}

export type TaskMovePlan =
  | { readonly kind: 'noop' }
  | { readonly kind: 'single'; readonly targetPosition: number }
  | {
      readonly kind: 'rebalance';
      readonly targetPosition: number;
      readonly siblingUpdates: ReadonlyArray<{ readonly id: string; readonly position: number }>;
    };

function isBeforeInOrder(
  a: { readonly position: number; readonly id: string },
  b: { readonly position: number; readonly id: string },
): boolean {
  if (a.position !== b.position) return a.position < b.position;
  return a.id < b.id;
}

function findVisibleSiblingIndex(
  orderedSiblings: readonly OrderedMoveSibling[],
  siblingId: string | null,
): number | null {
  if (siblingId === null) return null;
  const index = orderedSiblings.findIndex((sibling) => sibling.id === siblingId);
  if (index === -1 || !orderedSiblings[index]?.visibleToActor) {
    throw badRequest('errors.validation', {}, 'VALIDATION_ERROR');
  }
  return index;
}

function validateSiblingIndices(params: {
  readonly targetTaskId: string;
  readonly orderedSiblings: readonly OrderedMoveSibling[];
  readonly beforeId: string | null;
  readonly afterId: string | null;
}): { readonly beforeIdx: number | null; readonly afterIdx: number | null } {
  const { targetTaskId, orderedSiblings, beforeId, afterId } = params;
  if (beforeId === targetTaskId || afterId === targetTaskId) {
    throw badRequest('errors.validation', {}, 'VALIDATION_ERROR');
  }
  if (beforeId !== null && afterId !== null && beforeId === afterId) {
    throw badRequest('errors.validation', {}, 'VALIDATION_ERROR');
  }
  const beforeIdx = findVisibleSiblingIndex(orderedSiblings, beforeId);
  const afterIdx = findVisibleSiblingIndex(orderedSiblings, afterId);
  if (beforeIdx !== null && afterIdx !== null && beforeIdx >= afterIdx) {
    throw badRequest('errors.validation', {}, 'VALIDATION_ERROR');
  }
  return { beforeIdx, afterIdx };
}

function findVisibleNeighbors(
  orderedSiblings: readonly OrderedMoveSibling[],
  target: { readonly position: number; readonly id: string },
): { readonly prevVisibleId: string | null; readonly nextVisibleId: string | null } {
  let prevVisibleId: string | null = null;
  let nextVisibleId: string | null = null;
  for (const sibling of orderedSiblings) {
    if (!sibling.visibleToActor) continue;
    if (isBeforeInOrder(sibling, target)) {
      prevVisibleId = sibling.id;
    } else if (nextVisibleId === null) {
      nextVisibleId = sibling.id;
    }
  }
  return { prevVisibleId, nextVisibleId };
}

function isNoopMove(params: {
  readonly currentColumnId: string | null;
  readonly currentPosition: number;
  readonly targetTaskId: string;
  readonly destinationColumnId: string;
  readonly orderedSiblings: readonly OrderedMoveSibling[];
  readonly beforeId: string | null;
  readonly afterId: string | null;
}): boolean {
  if (params.currentColumnId !== params.destinationColumnId) return false;
  const target = { position: params.currentPosition, id: params.targetTaskId };
  if (params.beforeId === null && params.afterId === null) {
    return params.orderedSiblings.every((sibling) => isBeforeInOrder(sibling, target));
  }
  const { prevVisibleId, nextVisibleId } = findVisibleNeighbors(params.orderedSiblings, target);
  return params.beforeId === prevVisibleId && params.afterId === nextVisibleId;
}

function buildRebalancePlan(
  orderedSiblings: readonly OrderedMoveSibling[],
  insertIdx: number,
): TaskMovePlan {
  const siblingUpdates: Array<{ readonly id: string; readonly position: number }> = [];
  let targetPosition = (insertIdx + 1) * POSITION_STEP;

  for (let idx = 0; idx < orderedSiblings.length; idx += 1) {
    const newIndex = idx < insertIdx ? idx : idx + 1;
    siblingUpdates.push({
      id: orderedSiblings[idx]!.id,
      position: (newIndex + 1) * POSITION_STEP,
    });
  }
  if (insertIdx === orderedSiblings.length) {
    targetPosition = (orderedSiblings.length + 1) * POSITION_STEP;
  }
  return { kind: 'rebalance', targetPosition, siblingUpdates };
}

function resolveAfterBeforeIdx(
  orderedSiblings: readonly OrderedMoveSibling[],
  beforeIdx: number,
): TaskMovePlan {
  const beforePos = orderedSiblings[beforeIdx]!.position;
  if (beforeIdx === orderedSiblings.length - 1) {
    return { kind: 'single', targetPosition: beforePos + POSITION_STEP };
  }
  const nextPos = orderedSiblings[beforeIdx + 1]!.position;
  if (nextPos - beforePos >= MIN_POSITION_GAP) {
    return { kind: 'single', targetPosition: (beforePos + nextPos) / 2 };
  }
  return buildRebalancePlan(orderedSiblings, beforeIdx + 1);
}

function resolveBeforeAfterIdx(
  orderedSiblings: readonly OrderedMoveSibling[],
  afterIdx: number,
): TaskMovePlan {
  const afterPos = orderedSiblings[afterIdx]!.position;
  if (afterIdx === 0) {
    return { kind: 'single', targetPosition: afterPos - POSITION_STEP };
  }
  const prevPos = orderedSiblings[afterIdx - 1]!.position;
  if (afterPos - prevPos >= MIN_POSITION_GAP) {
    return { kind: 'single', targetPosition: (prevPos + afterPos) / 2 };
  }
  return buildRebalancePlan(orderedSiblings, afterIdx);
}

export function computeTaskMovePlan(params: ComputeTaskMovePlanParams): TaskMovePlan {
  const beforeId = params.beforeId ?? null;
  const afterId = params.afterId ?? null;
  const { beforeIdx, afterIdx } = validateSiblingIndices({
    targetTaskId: params.targetTaskId,
    orderedSiblings: params.orderedSiblings,
    beforeId,
    afterId,
  });

  if (
    isNoopMove({
      currentColumnId: params.currentColumnId,
      currentPosition: params.currentPosition,
      targetTaskId: params.targetTaskId,
      destinationColumnId: params.destinationColumnId,
      orderedSiblings: params.orderedSiblings,
      beforeId,
      afterId,
    })
  ) {
    return { kind: 'noop' };
  }

  if (params.orderedSiblings.length === 0) {
    return { kind: 'single', targetPosition: POSITION_STEP };
  }
  if (beforeIdx !== null) {
    return resolveAfterBeforeIdx(params.orderedSiblings, beforeIdx);
  }
  if (afterIdx !== null) {
    return resolveBeforeAfterIdx(params.orderedSiblings, afterIdx);
  }
  const lastPos = params.orderedSiblings[params.orderedSiblings.length - 1]!.position;
  return { kind: 'single', targetPosition: lastPos + POSITION_STEP };
}
