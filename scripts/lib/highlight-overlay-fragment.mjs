import { Accessor, NodeIO } from "@gltf-transform/core";
import { KHRDracoMeshCompression } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";

import { b3dmIdentity, readB3dm, writeB3dm } from "./background-lite-b3dm.mjs";

const parseJson = (bytes) =>
  JSON.parse(Buffer.from(bytes).toString("utf8").trim());
const paddedJson = (value) => {
  let json = JSON.stringify(value);
  while (Buffer.byteLength(json) % 8) json += " ";
  return Buffer.from(json);
};

let ioPromise;
async function nodeIo() {
  ioPromise ??= Promise.all([
    draco3d.createDecoderModule(),
    draco3d.createEncoderModule(),
  ]).then(([decoder, encoder]) =>
    new NodeIO()
      .registerExtensions([KHRDracoMeshCompression])
      .registerDependencies({
        "draco3d.decoder": decoder,
        "draco3d.encoder": encoder,
      }),
  );
  return ioPromise;
}

function filteredParts(parts, batchIds) {
  const feature = parseJson(parts.featureTableJson);
  const batch = parseJson(parts.batchTableJson);
  return {
    ...parts,
    featureTableJson: paddedJson({ ...feature, BATCH_LENGTH: batchIds.length }),
    batchTableJson: paddedJson(
      Object.fromEntries(
        Object.entries(batch).map(([key, value]) => [
          key,
          Array.isArray(value)
            ? batchIds.map((batchId) => value[batchId])
            : value,
        ]),
      ),
    ),
  };
}

function copyElement(accessor, oldIndex, target, newIndex, mapValue) {
  const source = accessor.getArray();
  for (let component = 0; component < accessor.getElementSize(); component += 1)
    target[newIndex * accessor.getElementSize() + component] = mapValue(
      source[oldIndex * accessor.getElementSize() + component],
    );
}

function filteredPrimitive(document, primitive, selectedTriangles, batchIndex) {
  const vertexMap = new Map();
  const oldIndices = primitive.getIndices().getArray();
  const newIndices = [];
  for (const { triangle } of selectedTriangles)
    for (let corner = 0; corner < 3; corner += 1) {
      const oldIndex = oldIndices[triangle * 3 + corner];
      if (!vertexMap.has(oldIndex)) vertexMap.set(oldIndex, vertexMap.size);
      newIndices.push(vertexMap.get(oldIndex));
    }
  const buffer = document.getRoot().listBuffers()[0] ?? document.createBuffer();
  const output = document
    .createPrimitive()
    .setMode(primitive.getMode())
    .setMaterial(primitive.getMaterial())
    .setIndices(
      document
        .createAccessor()
        .setType(Accessor.Type.SCALAR)
        .setArray(
          vertexMap.size <= 65_534
            ? new Uint16Array(newIndices)
            : new Uint32Array(newIndices),
        )
        .setBuffer(buffer),
    );
  for (const semantic of primitive.listSemantics()) {
    const oldAccessor = primitive.getAttribute(semantic);
    const ArrayType = oldAccessor.getArray().constructor;
    const values = new ArrayType(vertexMap.size * oldAccessor.getElementSize());
    for (const [oldIndex, newIndex] of vertexMap)
      copyElement(
        oldAccessor,
        oldIndex,
        values,
        newIndex,
        semantic === "_BATCHID"
          ? (value) => {
              const oldBatchId = Math.round(value);
              if (!batchIndex.has(oldBatchId))
                throw new Error(
                  `Selected triangle includes unselected batch ${oldBatchId}`,
                );
              return batchIndex.get(oldBatchId);
            }
          : (value) => value,
      );
    output.setAttribute(
      semantic,
      document
        .createAccessor()
        .setType(oldAccessor.getType())
        .setArray(values)
        .setNormalized(oldAccessor.getNormalized())
        .setBuffer(buffer),
    );
  }
  return output;
}

function filterDocument(document, batchIds) {
  const batchIndex = new Map(
    batchIds.map((batchId, index) => [batchId, index]),
  );
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes())
    for (const primitive of [...mesh.listPrimitives()]) {
      const batches = primitive.getAttribute("_BATCHID")?.getArray();
      const indices = primitive.getIndices()?.getArray();
      const selected = [];
      if (batches && indices)
        for (let triangle = 0; triangle < indices.length / 3; triangle += 1) {
          const values = [0, 1, 2].map((corner) =>
            Math.round(batches[indices[triangle * 3 + corner]]),
          );
          if (
            values.every(
              (value) => value === values[0] && batchIndex.has(value),
            )
          )
            selected.push({ triangle, batchId: values[0] });
        }
      if (selected.length) {
        triangles += selected.length;
        mesh.addPrimitive(
          filteredPrimitive(document, primitive, selected, batchIndex),
        );
      }
      mesh.removePrimitive(primitive);
      primitive.dispose();
    }
  for (const node of document.getRoot().listNodes())
    if (node.getMesh() && node.getMesh().listPrimitives().length === 0)
      node.dispose();
  if (!triangles)
    throw new Error(
      `Batches ${batchIds.join(",")} produced no overlay triangles`,
    );
}

export async function extractOverlayFragment(
  sourceBytes,
  { batchId, batchIds = batchId === undefined ? undefined : [batchId] } = {},
) {
  if (
    !Array.isArray(batchIds) ||
    batchIds.length === 0 ||
    batchIds.some((value) => !Number.isInteger(value) || value < 0) ||
    new Set(batchIds).size !== batchIds.length
  )
    throw new Error("One or more unique valid batch ids are required");
  const selectedBatchIds = [...batchIds].sort((left, right) => left - right);
  const parts = readB3dm(sourceBytes);
  const identity = b3dmIdentity(parts);
  const outOfRange = selectedBatchIds.find(
    (selectedBatchId) => selectedBatchId >= identity.batchLength,
  );
  if (outOfRange !== undefined)
    throw new Error(
      `Batch ${outOfRange} is outside BATCH_LENGTH ${identity.batchLength}`,
    );
  const io = await nodeIo();
  const document = await io.readBinary(new Uint8Array(parts.glb));
  filterDocument(document, selectedBatchIds);
  await document.transform(prune());
  return writeB3dm(
    filteredParts(parts, selectedBatchIds),
    Buffer.from(await io.writeBinary(document)),
  );
}
