// SPDX-License-Identifier: Apache-2.0

import type { ILayoutRect } from './layout';
import { rectLayer } from './layout';

/**
 * Relative surface height of the active layers (by magic name). Metal deposited over the boundary
 * between two different levels follows the step, which shows up as a line in a die shot.
 */
export const surfaceLevels: Record<string, number> = {
  nmos: 0,
  pwell: 1,
  ndiffusion: 2,
  pdiffusion: 2,
  psubstratepdiff: 2,
  nsubstratendiff: 2,
};

/** Metal layers from bottom to top; each one adds to the surface height of the metals above it */
export const metalLayers = ['metal1', 'metal2'];

const epsilon = 1e-3;

export interface ISegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface IStepLine extends ISegment {
  /** A diffusion edge inside p well: a shallower step that shows up fainter than the rest */
  faint: boolean;
}

export function containsPoint(rect: ILayoutRect, x: number, y: number) {
  return x > rect.x && x < rect.x + rect.width && y > rect.y && y < rect.y + rect.height;
}

function magicName(rect: ILayoutRect) {
  return rectLayer(rect)?.magicName ?? '';
}

/**
 * Surface height at the given point: the highest active level, plus one for each lower metal layer present.
 */
export function surfaceHeight(
  activeRects: ILayoutRect[],
  lowerMetals: ILayoutRect[][],
  x: number,
  y: number,
) {
  let height: number | undefined;
  for (const rect of activeRects) {
    if (containsPoint(rect, x, y)) {
      height = Math.max(height ?? 0, surfaceLevels[magicName(rect)]);
    }
  }
  if (height == null) {
    return undefined;
  }
  for (const metalRects of lowerMetals) {
    if (metalRects.some((rect) => containsPoint(rect, x, y))) {
      height++;
    }
  }
  return height;
}

/**
 * Returns the segments where a metal rect crosses a step in the surface below it,
 * caused by the active layers or by the metal layers underneath.
 */
export function metalStepLines(
  rects: ILayoutRect[],
  includeMetal: (rect: ILayoutRect) => boolean = () => true,
): IStepLine[] {
  const activeRects = rects.filter((r) => surfaceLevels[magicName(r)] != null);
  const metalsByLayer = metalLayers.map((name) => rects.filter((r) => magicName(r) === name));
  const result = new Map<string, IStepLine>();

  metalsByLayer.forEach((allMetalRects, metalIndex) => {
    const metalRects = allMetalRects.filter(includeMetal);
    if (metalRects.length === 0) {
      return;
    }

    const lowerMetals = metalsByLayer.slice(0, metalIndex);
    const edgeRects = [...activeRects, ...lowerMetals.flat()];
    const breakpointRects = [...edgeRects, ...metalRects];

    const addEdge = (horizontal: boolean, fixed: number, start: number, end: number) => {
      const breakpoints = new Set([start, end]);
      for (const rect of breakpointRects) {
        for (const value of horizontal
          ? [rect.x, rect.x + rect.width]
          : [rect.y, rect.y + rect.height]) {
          if (value > start && value < end) {
            breakpoints.add(value);
          }
        }
      }

      const sorted = Array.from(breakpoints).sort((a, b) => a - b);
      for (let i = 0; i < sorted.length - 1; i++) {
        const mid = (sorted[i] + sorted[i + 1]) / 2;
        const [x, y] = horizontal ? [mid, fixed] : [fixed, mid];
        if (!metalRects.some((metal) => containsPoint(metal, x, y))) {
          continue;
        }

        const before = horizontal
          ? surfaceHeight(activeRects, lowerMetals, x, y - epsilon)
          : surfaceHeight(activeRects, lowerMetals, x - epsilon, y);
        const after = horizontal
          ? surfaceHeight(activeRects, lowerMetals, x, y + epsilon)
          : surfaceHeight(activeRects, lowerMetals, x + epsilon, y);
        if (before == null || after == null || before === after) {
          continue;
        }

        // Active level on each side, ignoring the lower metals
        const activeBefore = horizontal
          ? surfaceHeight(activeRects, [], x, y - epsilon)
          : surfaceHeight(activeRects, [], x - epsilon, y);
        const activeAfter = horizontal
          ? surfaceHeight(activeRects, [], x, y + epsilon)
          : surfaceHeight(activeRects, [], x + epsilon, y);
        const faint =
          activeBefore != null &&
          activeAfter != null &&
          Math.min(activeBefore, activeAfter) === surfaceLevels.pwell &&
          Math.max(activeBefore, activeAfter) > surfaceLevels.pwell &&
          Math.abs(after - before) === Math.abs(activeAfter - activeBefore);

        const segment = horizontal
          ? { x1: sorted[i], y1: fixed, x2: sorted[i + 1], y2: fixed, faint }
          : { x1: fixed, y1: sorted[i], x2: fixed, y2: sorted[i + 1], faint };
        result.set(`${segment.x1},${segment.y1},${segment.x2},${segment.y2}`, segment);
      }
    };

    for (const { x, y, width, height } of edgeRects) {
      addEdge(true, y, x, x + width);
      addEdge(true, y + height, x, x + width);
      addEdge(false, x, y, y + height);
      addEdge(false, x + width, y, y + height);
    }
  });

  return Array.from(result.values());
}
