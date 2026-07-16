import { NodeIO } from "@gltf-transform/core";
import fs from "node:fs";

const modelPath = process.argv[2] || "public/models/esplanade-concert-cutaway.glb";

if (!fs.existsSync(modelPath)) {
  console.error(`Model not found: ${modelPath}`);
  process.exit(1);
}

const document = await new NodeIO().read(modelPath);
const root = document.getRoot();
const bounds = {
  min: [Infinity, Infinity, Infinity],
  max: [-Infinity, -Infinity, -Infinity],
};
let primitiveCount = 0;
let vertexCount = 0;
let triangleCount = 0;

for (const mesh of root.listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    primitiveCount += 1;

    const positions = primitive.getAttribute("POSITION");
    if (positions) {
      vertexCount += positions.getCount();
      const min = positions.getMin([]);
      const max = positions.getMax([]);
      for (let axis = 0; axis < 3; axis += 1) {
        bounds.min[axis] = Math.min(bounds.min[axis], min[axis]);
        bounds.max[axis] = Math.max(bounds.max[axis], max[axis]);
      }
    }

    const indices = primitive.getIndices();
    if (indices) {
      triangleCount += Math.floor(indices.getCount() / 3);
    } else if (positions) {
      triangleCount += Math.floor(positions.getCount() / 3);
    }
  }
}

const size = bounds.min.map((min, axis) => bounds.max[axis] - min);
const fileSize = fs.statSync(modelPath).size;

const report = {
  modelPath,
  fileSizeBytes: fileSize,
  fileSizeKb: Number((fileSize / 1024).toFixed(1)),
  scenes: root.listScenes().length,
  nodes: root.listNodes().length,
  meshes: root.listMeshes().length,
  primitives: primitiveCount,
  materials: root.listMaterials().length,
  textures: root.listTextures().length,
  animations: root.listAnimations().length,
  vertices: vertexCount,
  triangles: triangleCount,
  bounds: {
    min: bounds.min.map((value) => Number(value.toFixed(4))),
    max: bounds.max.map((value) => Number(value.toFixed(4))),
    size: size.map((value) => Number(value.toFixed(4))),
  },
};

console.log(JSON.stringify(report, null, 2));
