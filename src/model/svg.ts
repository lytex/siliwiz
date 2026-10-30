// SPDX-License-Identifier: Apache-2.0

import { downloadFile } from '~/utils/download-file';
import { LayerCategory, layerTypes } from './layerTypes';
import { layout, rectLayer } from './layout';
import { metalStepLines } from './topography';

/** Empty space around the layout in the SVG export */
const margin = 10;

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * SVG of the layout as seen in the 2D canvas view, with one Inkscape layer (group) per layer,
 * cropped to the bounds of the layout.
 */
export function exportSVG() {
  const rects = layout.rects.filter((rect) => rect.width > 0 && rect.height > 0 && rectLayer(rect));
  if (rects.length === 0) {
    return;
  }

  const minX = Math.min(...rects.map((r) => r.x)) - margin;
  const minY = Math.min(...rects.map((r) => r.y)) - margin;
  const width = Math.max(...rects.map((r) => r.x + r.width)) + margin - minX;
  const height = Math.max(...rects.map((r) => r.y + r.height)) + margin - minY;

  const patterns: string[] = [];
  const group = (id: string, label: string, content: string[]) =>
    `<g id="${id}" inkscape:groupmode="layer" inkscape:label="${escapeXml(label)}">
    ${content.join('\n    ')}
  </g>`;

  const layerGroups = layerTypes.map((layer, layerIndex) => {
    const layerRects = rects.filter((rect) => rect.layer === layer.name);
    if (layerRects.length === 0) {
      return null;
    }

    let fill: string;
    if (layer.category === LayerCategory.Via) {
      // Vias are drawn on top of metal as a darker outline, like in the canvas view
      fill = 'fill="black" fill-opacity="0.15" stroke="black" stroke-opacity="0.6"';
    } else if (layer.hatched) {
      const patternId = `hatch-${layerIndex}`;
      patterns.push(
        `<pattern id="${patternId}" patternUnits="userSpaceOnUse" width="20" height="20" patternTransform="rotate(-45 0 0)"><rect x="0" y="0" width="10" height="20" fill="${layer.color}" /></pattern>`,
      );
      fill = `fill="url(#${patternId})"`;
    } else {
      fill = `fill="${layer.color}"`;
    }

    return {
      via: layer.category === LayerCategory.Via,
      svg: group(
        `layer-${layerIndex}`,
        layer.name,
        layerRects.map(
          (r) => `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" ${fill} />`,
        ),
      ),
    };
  });

  // Steps in the surface under the metal show up as lines, drawn below the vias
  const stepLines = metalStepLines(rects).map(
    (line) =>
      `<line x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}" stroke="black" stroke-opacity="${line.faint ? 0.2 : 0.6}" />`,
  );

  const labels = rects
    .filter((rect) => rect.label != null)
    .map(
      (rect) =>
        `<text x="${rect.x + rect.width / 2}" y="${rect.y}" text-anchor="middle" dominant-baseline="hanging" font-family="sans-serif" font-size="16">${escapeXml(rect.label ?? '')}</text>`,
    );

  const layerSVGs = (via: boolean) =>
    layerGroups.flatMap((g) => (g != null && g.via === via ? [g.svg] : []));
  const groups = [
    ...layerSVGs(false),
    ...(stepLines.length ? [group('steps', 'surface steps', stepLines)] : []),
    ...layerSVGs(true),
    ...(labels.length ? [group('labels', 'labels', labels)] : []),
  ];

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}">
  <defs>
    ${patterns.join('\n    ')}
  </defs>
  ${groups.join('\n  ')}
</svg>
`;

  downloadFile('siliwiz.svg', svg, 'image/svg+xml');
}
