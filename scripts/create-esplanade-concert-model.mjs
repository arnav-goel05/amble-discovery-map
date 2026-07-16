import fs from "node:fs";
import path from "node:path";

import { Accessor, Document, NodeIO } from "@gltf-transform/core";

const OUTPUT_PATH = "public/models/esplanade-concert-mini.glb";

const document = new Document();
const buffer = document.createBuffer();

const materials = new Map();

function material(name, color) {
  if (!materials.has(name)) {
    materials.set(
      name,
      document
        .createMaterial(name)
        .setBaseColorFactor(color)
        .setRoughnessFactor(0.82)
        .setMetallicFactor(0.08),
    );
  }
  return materials.get(name);
}

const mesh = document.createMesh("esplanade-concert-mini-scene");

function addBox(name, center, size, colorName, color) {
  const [cx, cy, cz] = center;
  const [sx, sy, sz] = size.map((value) => value / 2);
  const corners = {
    nbl: [cx - sx, cy + sy, cz - sz],
    nbr: [cx + sx, cy + sy, cz - sz],
    ntl: [cx - sx, cy + sy, cz + sz],
    ntr: [cx + sx, cy + sy, cz + sz],
    sbl: [cx - sx, cy - sy, cz - sz],
    sbr: [cx + sx, cy - sy, cz - sz],
    stl: [cx - sx, cy - sy, cz + sz],
    str: [cx + sx, cy - sy, cz + sz],
  };

  const faces = [
    { points: [corners.sbl, corners.sbr, corners.str, corners.stl], normal: [0, -1, 0] },
    { points: [corners.nbr, corners.nbl, corners.ntl, corners.ntr], normal: [0, 1, 0] },
    { points: [corners.nbl, corners.sbl, corners.stl, corners.ntl], normal: [-1, 0, 0] },
    { points: [corners.sbr, corners.nbr, corners.ntr, corners.str], normal: [1, 0, 0] },
    { points: [corners.stl, corners.str, corners.ntr, corners.ntl], normal: [0, 0, 1] },
    { points: [corners.nbl, corners.nbr, corners.sbr, corners.sbl], normal: [0, 0, -1] },
  ];

  const positions = [];
  const normals = [];
  const indices = [];
  const toGltfAxis = ([east, north, up]) => [east, up, -north];

  for (const face of faces) {
    const offset = positions.length / 3;
    for (const point of face.points) {
      positions.push(...toGltfAxis(point));
      normals.push(...toGltfAxis(face.normal));
    }
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }

  const primitive = document
    .createPrimitive(name)
    .setAttribute(
      "POSITION",
      document
        .createAccessor(`${name}-positions`)
        .setType(Accessor.Type.VEC3)
        .setArray(new Float32Array(positions))
        .setBuffer(buffer),
    )
    .setAttribute(
      "NORMAL",
      document
        .createAccessor(`${name}-normals`)
        .setType(Accessor.Type.VEC3)
        .setArray(new Float32Array(normals))
        .setBuffer(buffer),
    )
    .setIndices(
      document
        .createAccessor(`${name}-indices`)
        .setType(Accessor.Type.SCALAR)
        .setArray(new Uint16Array(indices))
        .setBuffer(buffer),
    )
    .setMaterial(material(colorName, color));

  mesh.addPrimitive(primitive);
}

function addPerformer(prefix, x, y, bodyColor, pose = "guitar") {
  addBox(`${prefix}-body`, [x, y, 2.3], [1.15, 0.8, 2.8], `${prefix}-body`, bodyColor);
  addBox(`${prefix}-head`, [x, y, 4.05], [0.85, 0.75, 0.75], `${prefix}-head`, [1, 0.82, 0.58, 1]);
  addBox(`${prefix}-legs`, [x, y, 0.8], [1.05, 0.72, 1.4], `${prefix}-legs`, [0.1, 0.12, 0.18, 1]);

  if (pose === "guitar") {
    addBox(`${prefix}-guitar`, [x + 0.75, y - 0.25, 2.4], [0.9, 0.28, 1.15], `${prefix}-instrument`, [0.95, 0.57, 0.18, 1]);
    addBox(`${prefix}-neck`, [x + 1.2, y - 0.25, 3.15], [0.22, 0.18, 1.65], `${prefix}-instrument`, [0.95, 0.57, 0.18, 1]);
  }

  if (pose === "mic") {
    addBox(`${prefix}-mic-stand`, [x + 0.72, y - 0.05, 2.1], [0.12, 0.12, 3.3], "black", [0.05, 0.06, 0.08, 1]);
    addBox(`${prefix}-mic`, [x + 0.72, y - 0.22, 3.85], [0.65, 0.18, 0.18], "black", [0.05, 0.06, 0.08, 1]);
  }
}

function addAudience(prefix, x, y, color, height = 1.5) {
  addBox(`${prefix}-body`, [x, y, height / 2], [0.65, 0.55, height], `${prefix}-body`, color);
  addBox(`${prefix}-head`, [x, y, height + 0.34], [0.48, 0.44, 0.48], `${prefix}-head`, [1, 0.82, 0.58, 1]);
}

// Stage and equipment.
addBox("stage-base", [0, 0, 0.35], [22, 11, 0.7], "stage-base", [0.045, 0.055, 0.085, 1]);
addBox("stage-front-strip", [0, -5.8, 0.95], [22.5, 0.45, 0.5], "stage-gold", [1, 0.72, 0.22, 1]);
addBox("back-screen", [0, 5.15, 3.3], [15.5, 0.42, 5.5], "screen", [0.08, 0.11, 0.19, 1]);
addBox("screen-glow", [0, 4.88, 3.7], [12.8, 0.18, 3.8], "screen-glow", [0.18, 0.6, 0.95, 1]);
addBox("left-speaker", [-12.4, 1.2, 2.4], [1.8, 2.0, 4.1], "speaker", [0.025, 0.03, 0.04, 1]);
addBox("right-speaker", [12.4, 1.2, 2.4], [1.8, 2.0, 4.1], "speaker", [0.025, 0.03, 0.04, 1]);
addBox("left-truss", [-10.7, 3.6, 4.4], [0.38, 0.38, 7.2], "truss", [0.78, 0.8, 0.82, 1]);
addBox("right-truss", [10.7, 3.6, 4.4], [0.38, 0.38, 7.2], "truss", [0.78, 0.8, 0.82, 1]);
addBox("top-truss", [0, 3.6, 7.95], [22.1, 0.42, 0.42], "truss", [0.78, 0.8, 0.82, 1]);
addBox("blue-light", [-5.5, 3.2, 7.1], [1.1, 0.65, 0.8], "blue-light", [0.22, 0.67, 1, 1]);
addBox("pink-light", [0, 3.2, 7.1], [1.1, 0.65, 0.8], "pink-light", [1, 0.25, 0.64, 1]);
addBox("gold-light", [5.5, 3.2, 7.1], [1.1, 0.65, 0.8], "gold-light", [1, 0.74, 0.22, 1]);

// Band.
addPerformer("singer", -4.8, -0.9, [1, 0.82, 0.26, 1], "mic");
addPerformer("guitarist", [0.2, -1.1, 0], [0.25, 0.72, 1, 1], "guitar");
addPerformer("bassist", [5.1, -0.85, 0], [1, 0.32, 0.68, 1], "guitar");
addBox("drum-base", [0.2, 2.3, 1.3], [2.1, 1.15, 1.25], "drums", [0.95, 0.95, 0.98, 1]);
addBox("drum-top", [0.2, 2.3, 2.05], [1.7, 0.95, 0.28], "drum-top", [0.2, 0.26, 0.34, 1]);
addBox("left-cymbal", [-1.35, 2.4, 2.75], [1.15, 0.18, 0.12], "cymbal", [1, 0.82, 0.34, 1]);
addBox("right-cymbal", [1.75, 2.4, 2.8], [1.15, 0.18, 0.12], "cymbal", [1, 0.82, 0.34, 1]);

// Crowd cluster, intentionally readable rather than literal scale.
[
  [-8.8, -9.2, [1, 1, 1, 1]],
  [-5.8, -10.4, [1, 0.76, 0.28, 1]],
  [-2.6, -9.7, [0.65, 0.9, 1, 1]],
  [0.8, -10.8, [1, 1, 1, 1]],
  [4.0, -9.6, [1, 0.76, 0.28, 1]],
  [7.3, -10.2, [0.95, 0.45, 0.76, 1]],
  [-7.2, -13.1, [0.65, 0.9, 1, 1]],
  [-3.6, -13.8, [1, 1, 1, 1]],
  [0.0, -13.1, [1, 0.76, 0.28, 1]],
  [3.4, -14.1, [0.95, 0.45, 0.76, 1]],
  [6.8, -13.2, [1, 1, 1, 1]],
].forEach(([x, y, color], index) => addAudience(`audience-${index}`, x, y, color, index % 3 === 0 ? 1.8 : 1.45));

document.createScene("Scene").addChild(document.createNode("concert-root").setMesh(mesh));

const io = new NodeIO();
fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
await io.write(OUTPUT_PATH, document);

console.log(`Wrote ${OUTPUT_PATH}`);
