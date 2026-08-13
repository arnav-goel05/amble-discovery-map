import { createHash } from "node:crypto";

const JSON_CHUNK = 0x4e4f534a;
const paddedJson = (bytes) =>
  JSON.parse(Buffer.from(bytes).toString("utf8").replace(/\0+$/u, "").trim());

export function readB3dm(bytes, source = "") {
  const buffer = Buffer.from(bytes);
  if (buffer.subarray(0, 4).toString("ascii") !== "b3dm")
    throw new Error(`Not a B3DM tile: ${source}`);
  const featureJsonLength = buffer.readUInt32LE(12);
  const featureBinaryLength = buffer.readUInt32LE(16);
  const batchJsonLength = buffer.readUInt32LE(20);
  const batchBinaryLength = buffer.readUInt32LE(24);
  const featureJsonStart = 28;
  const featureBinaryStart = featureJsonStart + featureJsonLength;
  const batchJsonStart = featureBinaryStart + featureBinaryLength;
  const batchBinaryStart = batchJsonStart + batchJsonLength;
  const glbStart = batchBinaryStart + batchBinaryLength;
  return {
    header: {
      version: buffer.readUInt32LE(4),
      declaredByteLength: buffer.readUInt32LE(8),
    },
    featureTableJson: buffer.subarray(featureJsonStart, featureBinaryStart),
    featureTableBinary: buffer.subarray(featureBinaryStart, batchJsonStart),
    batchTableJson: buffer.subarray(batchJsonStart, batchBinaryStart),
    batchTableBinary: buffer.subarray(batchBinaryStart, glbStart),
    glb: buffer.subarray(glbStart),
  };
}

export function writeB3dm(parts, glb) {
  const byteLength =
    28 +
    parts.featureTableJson.byteLength +
    parts.featureTableBinary.byteLength +
    parts.batchTableJson.byteLength +
    parts.batchTableBinary.byteLength +
    glb.byteLength;
  const header = Buffer.alloc(28);
  header.write("b3dm", 0, 4, "ascii");
  header.writeUInt32LE(parts.header.version, 4);
  header.writeUInt32LE(byteLength, 8);
  header.writeUInt32LE(parts.featureTableJson.byteLength, 12);
  header.writeUInt32LE(parts.featureTableBinary.byteLength, 16);
  header.writeUInt32LE(parts.batchTableJson.byteLength, 20);
  header.writeUInt32LE(parts.batchTableBinary.byteLength, 24);
  return Buffer.concat([
    header,
    parts.featureTableJson,
    parts.featureTableBinary,
    parts.batchTableJson,
    parts.batchTableBinary,
    glb,
  ]);
}

export function b3dmIdentity(parts) {
  const featureTable = paddedJson(parts.featureTableJson);
  const batchTable = paddedJson(parts.batchTableJson);
  return {
    batchLength: featureTable.BATCH_LENGTH ?? null,
    gmlIds: batchTable["gml:id"] ?? [],
    gmlNames: batchTable["gml:name"] ?? [],
    featureTableSha256: createHash("sha256")
      .update(parts.featureTableJson)
      .update(parts.featureTableBinary)
      .digest("hex"),
    batchTableSha256: createHash("sha256")
      .update(parts.batchTableJson)
      .update(parts.batchTableBinary)
      .digest("hex"),
  };
}

export function inspectGlb(glb) {
  const buffer = Buffer.from(glb);
  if (buffer.subarray(0, 4).toString("ascii") !== "glTF")
    throw new Error("B3DM payload is not a GLB");
  const length = buffer.readUInt32LE(8);
  let cursor = 12;
  let json = null;
  while (cursor + 8 <= length) {
    const chunkLength = buffer.readUInt32LE(cursor);
    const chunkType = buffer.readUInt32LE(cursor + 4);
    if (chunkType === JSON_CHUNK)
      json = JSON.parse(
        buffer
          .subarray(cursor + 8, cursor + 8 + chunkLength)
          .toString("utf8")
          .replace(/\0+$/u, "")
          .trim(),
      );
    cursor += 8 + chunkLength;
  }
  if (!json) throw new Error("GLB has no JSON chunk");
  const { binary } = glbChunks(buffer);
  const imageViews = new Set(
    (json.images ?? [])
      .map(({ bufferView }) => bufferView)
      .filter(Number.isInteger),
  );
  const retainedBufferViewHash = createHash("sha256");
  for (const [index, view] of (json.bufferViews ?? []).entries()) {
    if (imageViews.has(index)) continue;
    const start = view.byteOffset ?? 0;
    retainedBufferViewHash.update(
      binary.subarray(start, start + view.byteLength),
    );
  }
  const accessors = json.accessors ?? [];
  let vertices = 0;
  let triangles = 0;
  const semantics = new Set();
  const dracoSemantics = new Set();
  for (const mesh of json.meshes ?? [])
    for (const primitive of mesh.primitives ?? []) {
      vertices += accessors[primitive.attributes?.POSITION]?.count ?? 0;
      triangles += Math.floor((accessors[primitive.indices]?.count ?? 0) / 3);
      Object.keys(primitive.attributes ?? {}).forEach((name) =>
        semantics.add(name),
      );
      Object.keys(
        primitive.extensions?.KHR_draco_mesh_compression?.attributes ?? {},
      ).forEach((name) => dracoSemantics.add(name));
    }
  return {
    byteLength: buffer.length,
    images: json.images?.length ?? 0,
    textures: json.textures?.length ?? 0,
    materials: json.materials?.length ?? 0,
    vertices,
    triangles,
    semantics: [...semantics].sort(),
    dracoSemantics: [...dracoSemantics].sort(),
    retainedBufferViewSha256: retainedBufferViewHash.digest("hex"),
    extensionsUsed: json.extensionsUsed ?? [],
    extensionsRequired: json.extensionsRequired ?? [],
  };
}

export function glbChunks(glb) {
  const buffer = Buffer.from(glb);
  if (buffer.subarray(0, 4).toString("ascii") !== "glTF")
    throw new Error("B3DM payload is not a GLB");
  const length = buffer.readUInt32LE(8);
  let cursor = 12;
  let json = null;
  let binary = Buffer.alloc(0);
  while (cursor + 8 <= length) {
    const chunkLength = buffer.readUInt32LE(cursor);
    const chunkType = buffer.readUInt32LE(cursor + 4);
    const chunk = buffer.subarray(cursor + 8, cursor + 8 + chunkLength);
    if (chunkType === JSON_CHUNK)
      json = JSON.parse(chunk.toString("utf8").replace(/\0+$/u, "").trim());
    else if (chunkType === 0x004e4942) binary = chunk;
    cursor += 8 + chunkLength;
  }
  if (!json) throw new Error("GLB has no JSON chunk");
  return { json, binary };
}

export function paddedChunk(value, paddingByte) {
  const remainder = value.length % 4;
  return remainder
    ? Buffer.concat([value, Buffer.alloc(4 - remainder, paddingByte)])
    : value;
}

export function buildGlb(json, binary) {
  const jsonBytes = paddedChunk(
    Buffer.from(JSON.stringify(json), "utf8"),
    0x20,
  );
  const binaryBytes = paddedChunk(binary, 0);
  const length =
    12 +
    8 +
    jsonBytes.length +
    (binaryBytes.length ? 8 + binaryBytes.length : 0);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, 4, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBytes.length, 0);
  jsonHeader.writeUInt32LE(JSON_CHUNK, 4);
  const chunks = [header, jsonHeader, jsonBytes];
  if (binaryBytes.length) {
    const binaryHeader = Buffer.alloc(8);
    binaryHeader.writeUInt32LE(binaryBytes.length, 0);
    binaryHeader.writeUInt32LE(0x004e4942, 4);
    chunks.push(binaryHeader, binaryBytes);
  }
  return Buffer.concat(chunks);
}

export function remapBufferViewReferences(value, remap, objectPath = "") {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      remapBufferViewReferences(item, remap, `${objectPath}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "bufferView" && Number.isInteger(child)) {
      if (!remap.has(child))
        throw new Error(
          `Removed image buffer view ${child} is still referenced at ${objectPath}.${key}`,
        );
      value[key] = remap.get(child);
    } else remapBufferViewReferences(child, remap, `${objectPath}.${key}`);
  }
}
