import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { writeB3dm } from "../../../scripts/lib/background-lite-b3dm.mjs";

const pad = (value) => {
  let text = JSON.stringify(value);
  while (Buffer.byteLength(text) % 8) text += " ";
  return Buffer.from(text);
};

function glb({
  image,
  imageMimeType = "image/png",
  otherTexture = null,
  ambiguousTexture = false,
}) {
  const geometry = Buffer.from("fixture-geometry");
  const images = otherTexture ? [image, otherTexture] : [image];
  const binary = Buffer.concat([geometry, ...images]);
  let byteOffset = geometry.length;
  const imageViews = images.map((bytes) => {
    const view = { buffer: 0, byteOffset, byteLength: bytes.length };
    byteOffset += bytes.length;
    return view;
  });
  const binaryChunk = Buffer.concat([
    binary,
    Buffer.alloc((4 - (binary.length % 4)) % 4),
  ]);
  const json = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: geometry.length },
      ...imageViews,
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC2" },
      { bufferView: 0, componentType: 5126, count: 3, type: "SCALAR" },
      { bufferView: 0, componentType: 5123, count: 3, type: "SCALAR" },
    ],
    images: images.map((_, index) => ({
      bufferView: index + 1,
      mimeType: index === 0 ? imageMimeType : "image/png",
    })),
    textures: images.map((_, source) => ({ source })),
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          ...(otherTexture ? { metallicRoughnessTexture: { index: 1 } } : {}),
        },
        ...(ambiguousTexture ? { normalTexture: { index: 0 } } : {}),
      },
    ],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, _BATCHID: 3 },
            indices: 4,
            material: 0,
            extensions: {
              KHR_draco_mesh_compression: {
                bufferView: 0,
                attributes: {
                  POSITION: 0,
                  NORMAL: 1,
                  TEXCOORD_0: 2,
                  _BATCHID: 3,
                },
              },
            },
          },
        ],
      },
    ],
    extensionsUsed: ["KHR_draco_mesh_compression"],
    extensionsRequired: ["KHR_draco_mesh_compression"],
  };
  let jsonBytes = Buffer.from(JSON.stringify(json));
  while (jsonBytes.length % 4)
    jsonBytes = Buffer.concat([jsonBytes, Buffer.from(" ")]);
  const header = Buffer.alloc(12);
  header.write("glTF");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + binaryChunk.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBytes.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binaryChunk.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([
    header,
    jsonHeader,
    jsonBytes,
    binaryHeader,
    binaryChunk,
  ]);
}

export async function syntheticTile({
  colour = { r: 42, g: 110, b: 178, alpha: 1 },
  dimensions = [256, 192],
  ids = ["building-1"],
  names = ["One"],
  otherTexture = false,
  ambiguousTexture = false,
  grayscale = false,
  imageMimeType = "image/png",
} = {}) {
  const channels = colour.alpha < 1 ? 4 : 3;
  let imagePipeline = sharp({
    create: {
      width: dimensions[0],
      height: dimensions[1],
      channels,
      background: colour,
    },
  });
  if (grayscale) imagePipeline = imagePipeline.grayscale();
  const image = await imagePipeline.png().toBuffer();
  const nonColour = otherTexture
    ? await sharp({
        create: {
          width: 16,
          height: 16,
          channels: 3,
          background: { r: 128, g: 128, b: 255 },
        },
      })
        .png()
        .toBuffer()
    : null;
  return writeB3dm(
    {
      header: { version: 1 },
      featureTableJson: pad({ BATCH_LENGTH: ids.length }),
      featureTableBinary: Buffer.alloc(0),
      batchTableJson: pad({ "gml:id": ids, "gml:name": names }),
      batchTableBinary: Buffer.alloc(0),
    },
    glb({ image, imageMimeType, otherTexture: nonColour, ambiguousTexture }),
  );
}

export async function createSyntheticSource(root, { count = 3 } = {}) {
  const sourceRoot = path.join(root, "tiles");
  const children = [];
  for (let index = 0; index < count; index += 1) {
    const canonicalPath = `1/2/${index}_0.b3dm`;
    const destination = path.join(sourceRoot, canonicalPath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const ids =
      index === 0
        ? ["highlighted-building", "background-building"]
        : [`building-${index}`];
    fs.writeFileSync(
      destination,
      await syntheticTile({
        colour: {
          r: 35 + ((index * 31) % 180),
          g: 60 + ((index * 17) % 150),
          b: 90 + ((index * 23) % 140),
          alpha: 1,
        },
        dimensions: index % 2 ? [64, 48] : [256, 192],
        ids,
        names: ids.map((id) => `Name ${id}`),
        otherTexture: index === 1,
      }),
    );
    children.push({
      boundingVolume: { region: [0, 0, 1, 1, 0, 10] },
      geometricError: 0,
      content: { uri: `./${canonicalPath}` },
    });
  }
  const tileset = {
    asset: { version: "1.0" },
    geometricError: 1,
    root: {
      boundingVolume: { region: [0, 0, 1, 1, 0, 10] },
      geometricError: 1,
      refine: "ADD",
      children,
    },
  };
  fs.writeFileSync(
    path.join(sourceRoot, "tileset.json"),
    JSON.stringify(tileset),
  );
  return { sourceRoot, tileset };
}
