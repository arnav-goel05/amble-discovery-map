import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const reportPath = path.resolve(
  root,
  option(
    "report",
    "outputs/map-performance-diagnostics/hardware-root-cause/report.json",
  ),
);
const outputPath = path.resolve(
  root,
  option(
    "output",
    "outputs/map-performance-diagnostics/hardware-root-cause/assets.json",
  ),
);
const limit = Number(option("limit", "30"));

export function inspectB3dm(buffer, sourcePath = "") {
  if (buffer.subarray(0, 4).toString("ascii") !== "b3dm")
    throw new Error(`Not a B3DM asset: ${sourcePath}`);
  const declaredBytes = buffer.readUInt32LE(8);
  const featureJsonBytes = buffer.readUInt32LE(12);
  const featureBinaryBytes = buffer.readUInt32LE(16);
  const batchJsonBytes = buffer.readUInt32LE(20);
  const batchBinaryBytes = buffer.readUInt32LE(24);
  const glbOffset =
    28 +
    featureJsonBytes +
    featureBinaryBytes +
    batchJsonBytes +
    batchBinaryBytes;
  if (buffer.subarray(glbOffset, glbOffset + 4).toString("ascii") !== "glTF")
    throw new Error(`B3DM has no embedded GLB: ${sourcePath}`);
  const glbLength = buffer.readUInt32LE(glbOffset + 8);
  let cursor = glbOffset + 12;
  let json = null;
  let binaryBytes = 0;
  let binaryChunk = null;
  while (cursor + 8 <= glbOffset + glbLength) {
    const chunkLength = buffer.readUInt32LE(cursor);
    const chunkType = buffer.readUInt32LE(cursor + 4);
    const chunk = buffer.subarray(cursor + 8, cursor + 8 + chunkLength);
    if (chunkType === 0x4e4f534a)
      json = JSON.parse(chunk.toString("utf8").replace(/\0+$/g, "").trim());
    if (chunkType === 0x004e4942) {
      binaryBytes += chunkLength;
      binaryChunk = chunk;
    }
    cursor += 8 + chunkLength;
  }
  if (!json) throw new Error(`Embedded GLB has no JSON chunk: ${sourcePath}`);
  const accessors = json.accessors ?? [];
  let vertices = 0;
  let indices = 0;
  let primitives = 0;
  for (const mesh of json.meshes ?? [])
    for (const primitive of mesh.primitives ?? []) {
      primitives += 1;
      vertices += accessors[primitive.attributes?.POSITION]?.count ?? 0;
      indices += accessors[primitive.indices]?.count ?? 0;
    }
  const imageDimensions = (bytes, mimeType) => {
    if (mimeType === "image/png" && bytes.length >= 24)
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    if (mimeType === "image/jpeg") {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = bytes[offset + 1];
        const length = bytes.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xc3)
          return {
            width: bytes.readUInt16BE(offset + 7),
            height: bytes.readUInt16BE(offset + 5),
          };
        if (length < 2) break;
        offset += 2 + length;
      }
    }
    if (mimeType === "image/tiff" && bytes.length >= 12) {
      const littleEndian = bytes.subarray(0, 2).toString("ascii") === "II";
      const read16 = (offset) =>
        littleEndian ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset);
      const read32 = (offset) =>
        littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
      const directoryOffset = read32(4);
      const entries = read16(directoryOffset);
      let width = null;
      let height = null;
      for (let index = 0; index < entries; index += 1) {
        const offset = directoryOffset + 2 + index * 12;
        const tag = read16(offset);
        const type = read16(offset + 2);
        const value = type === 3 ? read16(offset + 8) : read32(offset + 8);
        if (tag === 256) width = value;
        if (tag === 257) height = value;
      }
      return { width, height };
    }
    return { width: null, height: null };
  };
  const imageDetails = (json.images ?? []).map((image) => {
    const view = json.bufferViews?.[image.bufferView];
    const byteLength = view?.byteLength ?? 0;
    const bytes =
      binaryChunk && view
        ? binaryChunk.subarray(
            view.byteOffset ?? 0,
            (view.byteOffset ?? 0) + byteLength,
          )
        : Buffer.alloc(0);
    const detectedMimeType = bytes
      .subarray(0, 8)
      .equals(Buffer.from("89504e470d0a1a0a", "hex"))
      ? "image/png"
      : bytes[0] === 0xff && bytes[1] === 0xd8
        ? "image/jpeg"
        : image.mimeType;
    const dimensions = imageDimensions(bytes, detectedMimeType);
    return {
      mimeType: image.mimeType ?? null,
      detectedMimeType,
      mimeTypeMismatch:
        Boolean(image.mimeType) && image.mimeType !== detectedMimeType,
      byteLength,
      ...dimensions,
      estimatedDecodedRGBABytes:
        dimensions.width && dimensions.height
          ? dimensions.width * dimensions.height * 4
          : null,
    };
  });
  const imageBytes = imageDetails.reduce(
    (sum, image) => sum + image.byteLength,
    0,
  );
  return {
    sourcePath,
    fileBytes: buffer.length,
    declaredBytes,
    glbBytes: glbLength,
    binaryBytes,
    meshes: json.meshes?.length ?? 0,
    primitives,
    vertices,
    indices,
    estimatedTriangles: Math.floor(indices / 3),
    materials: json.materials?.length ?? 0,
    textures: json.textures?.length ?? 0,
    images: json.images?.length ?? 0,
    imageBytes,
    imageDetails,
    estimatedDecodedRGBABytes: imageDetails.reduce(
      (sum, image) => sum + (image.estimatedDecodedRGBABytes ?? 0),
      0,
    ),
    extensionsUsed: json.extensionsUsed ?? [],
    extensionsRequired: json.extensionsRequired ?? [],
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

export async function inspectObservedAssets({
  reportFile = reportPath,
  outputFile = outputPath,
  assetLimit = limit,
} = {}) {
  const report = JSON.parse(await readFile(reportFile, "utf8"));
  const observed = new Map();
  for (const trial of report.trials ?? [])
    for (const resource of trial.network?.resources ?? []) {
      const pathname = new URL(resource.url).pathname;
      const current = observed.get(pathname);
      if (!current || resource.encodedBytes > current.encodedBytes)
        observed.set(pathname, {
          pathname,
          encodedBytes: resource.encodedBytes,
        });
    }
  const selected = [...observed.values()]
    .sort((left, right) => right.encodedBytes - left.encodedBytes)
    .slice(0, assetLimit);
  const assets = [];
  for (const resource of selected) {
    const localPath = resource.pathname.startsWith("/poi-tiles/")
      ? path.join(root, "public", resource.pathname)
      : path.join(root, resource.pathname);
    const buffer = await readFile(localPath);
    assets.push({
      observedEncodedBytes: resource.encodedBytes,
      ...inspectB3dm(buffer, path.relative(root, localPath)),
    });
  }
  const summary = {
    schemaVersion: 1,
    report: path.relative(root, reportFile),
    observedAssetCount: observed.size,
    inspectedAssetCount: assets.length,
    inspectedBytes: assets.reduce((sum, asset) => sum + asset.fileBytes, 0),
    vertices: assets.reduce((sum, asset) => sum + asset.vertices, 0),
    triangles: assets.reduce((sum, asset) => sum + asset.estimatedTriangles, 0),
    imageBytes: assets.reduce((sum, asset) => sum + asset.imageBytes, 0),
    estimatedDecodedRGBABytes: assets.reduce(
      (sum, asset) => sum + asset.estimatedDecodedRGBABytes,
      0,
    ),
    assets,
  };
  await writeFile(outputFile, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await inspectObservedAssets();
  console.log(path.relative(root, outputPath));
}
