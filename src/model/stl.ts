import { strToU8, zipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { Color } from 'three/src/math/Color.js';
import { downloadFile } from '~/utils/download-file';
import { layerTypes } from './layerTypes';
import { layout, rectLayer, rectViaLayer } from './layout';
import { surfaceLevels } from './topography';

type Vec3 = [number, number, number];

interface IBox {
  min: Vec3;
  max: Vec3;
}

interface IExportLayer {
  name: string;
  color: Color;
  boxes: IBox[];
}

/** Box corner indices, following the bit pattern (x, y, z) => x | y << 1 | z << 2 */
const boxTriangles: Array<[number, number, number]> = [
  [0, 2, 3],
  [0, 3, 1], // -z
  [4, 5, 7],
  [4, 7, 6], // +z
  [0, 1, 5],
  [0, 5, 4], // -y
  [2, 6, 7],
  [2, 7, 3], // +y
  [0, 4, 6],
  [0, 6, 2], // -x
  [1, 3, 7],
  [1, 7, 5], // +x
];

const boxNormals: Vec3[] = [
  [0, 0, -1],
  [0, 0, 1],
  [0, -1, 0],
  [0, 1, 0],
  [-1, 0, 0],
  [1, 0, 0],
];

function boxCorners({ min, max }: IBox): Vec3[] {
  const corners: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    corners.push([i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]);
  }
  return corners;
}

/** How much each surface level (p well, then diffusion / tap) is raised above the one below in the 3MF export */
const surfaceStepHeight = 2;

/**
 * Groups the layout rects by their layer (in the same order as the layer list),
 * using the same color as the 2D canvas view.
 * The top of each active layer is raised by `stepHeight` per surface level, so they stand out from the substrate.
 */
function collectLayers(stepHeight = 0): IExportLayer[] {
  const result = new Map<string, IExportLayer>();
  for (const layer of layerTypes) {
    result.set(layer.name, { name: layer.name, color: new Color(layer.color), boxes: [] });
  }

  for (const rect of layout.rects) {
    const layer = rectLayer(rect);
    const viaLayer = rectViaLayer(layout, rect);
    if (!viaLayer || !layer) {
      continue;
    }

    const raise = (surfaceLevels[layer.magicName] ?? 0) * stepHeight;
    result.get(layer.name)?.boxes.push({
      min: [rect.x, -(rect.y + rect.height), -viaLayer.crossY - viaLayer.crossHeight],
      max: [rect.x + rect.width, -rect.y, -viaLayer.crossY + raise],
    });
  }

  return Array.from(result.values()).filter((layer) => layer.boxes.length > 0);
}

/**
 * Binary STL, with the faces of each layer stored consecutively and colored using the
 * VisCAM / SolidView per-facet color convention (bit 15 = valid, 5 bits per channel, RGB).
 */
export function exportSTL() {
  const layers = collectLayers();
  const triangleCount = layers.reduce((sum, layer) => sum + layer.boxes.length * 12, 0);

  const buffer = new ArrayBuffer(84 + triangleCount * 50);
  const view = new DataView(buffer);
  const header = `siliwiz layers: ${layers.map((layer) => layer.name).join(', ')}`;
  for (let i = 0; i < Math.min(header.length, 80); i++) {
    view.setUint8(i, header.charCodeAt(i) & 0x7f);
  }
  view.setUint32(80, triangleCount, true);

  let offset = 84;
  for (const layer of layers) {
    const { r, g, b } = layer.color;
    const to5 = (v: number) => Math.round(v * 31) & 0x1f;
    const packedColor = 0x8000 | (to5(r) << 10) | (to5(g) << 5) | to5(b);

    for (const box of layer.boxes) {
      const corners = boxCorners(box);
      boxTriangles.forEach((triangle, index) => {
        for (const value of boxNormals[index >> 1]) {
          view.setFloat32(offset, value, true);
          offset += 4;
        }
        for (const corner of triangle) {
          for (const value of corners[corner]) {
            view.setFloat32(offset, value, true);
            offset += 4;
          }
        }
        view.setUint16(offset, packedColor, true);
        offset += 2;
      });
    }
  }

  downloadFile('siliwiz.stl', buffer);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 3MF file with one named, colored part per layer, assembled into a single object
 * (so slicers keep the parts aligned and can assign a filament per layer).
 */
export function export3MF() {
  const layers = collectLayers(surfaceStepHeight);

  const materials = layers
    .map(
      (layer) =>
        `<base name="${escapeXml(layer.name)}" displaycolor="#${layer.color.getHexString().toUpperCase()}FF" />`,
    )
    .join('\n      ');

  const objects = layers.map((layer, layerIndex) => {
    const vertices: string[] = [];
    const triangles: string[] = [];
    for (const box of layer.boxes) {
      const base = vertices.length;
      for (const [x, y, z] of boxCorners(box)) {
        vertices.push(`<vertex x="${x}" y="${y}" z="${z}" />`);
      }
      for (const [v1, v2, v3] of boxTriangles) {
        triangles.push(`<triangle v1="${base + v1}" v2="${base + v2}" v3="${base + v3}" />`);
      }
    }
    return `<object id="${layerIndex + 2}" name="${escapeXml(layer.name)}" type="model" pid="1" pindex="${layerIndex}">
      <mesh>
        <vertices>${vertices.join('')}</vertices>
        <triangles>${triangles.join('')}</triangles>
      </mesh>
    </object>`;
  });

  const assemblyId = layers.length + 2;
  const components = layers
    .map((_, layerIndex) => `<component objectid="${layerIndex + 2}" />`)
    .join('');

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">SiliWiz</metadata>
  <resources>
    <basematerials id="1">
      ${materials}
    </basematerials>
    ${objects.join('\n    ')}
    <object id="${assemblyId}" name="siliwiz" type="model">
      <components>${components}</components>
    </object>
  </resources>
  <build>
    <item objectid="${assemblyId}" />
  </build>
</model>
`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>
`;

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>
`;

  const zip = zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(model),
  });
  downloadFile('siliwiz.3mf', zip.slice().buffer, 'model/3mf');
}
