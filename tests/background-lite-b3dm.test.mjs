import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  b3dmIdentity,
  inspectGlb,
  makeBackgroundDominantColor,
  makeBackgroundLite,
  makeBackgroundTextureLite,
  readB3dm,
  writeB3dm,
} from "../scripts/lib/background-lite-b3dm.mjs";
import { syntheticTile } from "./fixtures/background-lite-local/fixture.mjs";

const pad = (value) => {
  let json = JSON.stringify(value);
  while (Buffer.byteLength(json) % 8) json += " ";
  return Buffer.from(json);
};

function glbFixture(
  image = Buffer.from("fake-image-payload-that-should-be-removed"),
) {
  const geometry = Buffer.from("geometry-payload!");
  const binary = Buffer.concat([geometry, image]);
  const binaryPadding = Buffer.alloc((4 - (binary.length % 4)) % 4);
  const binaryChunk = Buffer.concat([binary, binaryPadding]);
  const json = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: geometry.length },
      { buffer: 0, byteOffset: geometry.length, byteLength: image.length },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 12, type: "VEC3" },
      { bufferView: 0, componentType: 5126, count: 12, type: "VEC3" },
      { bufferView: 0, componentType: 5126, count: 12, type: "VEC2" },
      { bufferView: 0, componentType: 5126, count: 12, type: "SCALAR" },
      { bufferView: 0, componentType: 5123, count: 18, type: "SCALAR" },
    ],
    images: [{ bufferView: 1, mimeType: "image/png" }],
    textures: [{ source: 0 }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    meshes: [
      {
        primitives: [
          {
            attributes: {
              POSITION: 0,
              NORMAL: 1,
              TEXCOORD_0: 2,
              _BATCHID: 3,
            },
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

function b3dmFixture(image) {
  const parts = {
    header: { version: 1 },
    featureTableJson: pad({ BATCH_LENGTH: 1 }),
    featureTableBinary: Buffer.alloc(0),
    batchTableJson: pad({ "gml:id": ["building-1"], "gml:name": ["One"] }),
    batchTableBinary: Buffer.alloc(0),
  };
  return writeB3dm(parts, glbFixture(image));
}

function embeddedImages(tile) {
  const glb = readB3dm(tile).glb;
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(
    glb
      .subarray(20, 20 + jsonLength)
      .toString("utf8")
      .trim(),
  );
  const binaryHeader = 20 + jsonLength;
  const binary = glb.subarray(binaryHeader + 8);
  return (json.images ?? []).map((image) => {
    const view = json.bufferViews[image.bufferView];
    const start = view.byteOffset ?? 0;
    return {
      bytes: binary.subarray(start, start + view.byteLength),
      mimeType: image.mimeType,
    };
  });
}

test("background-lite removes texture payloads without changing geometry or identity contracts", async () => {
  const source = b3dmFixture();
  const lite = await makeBackgroundLite(source);
  const before = readB3dm(source);
  const after = readB3dm(lite);
  assert.deepEqual(b3dmIdentity(after), b3dmIdentity(before));
  assert.ok(lite.length < source.length);
  const beforeGlb = inspectGlb(before.glb);
  const afterGlb = inspectGlb(after.glb);
  assert.equal(
    afterGlb.retainedBufferViewSha256,
    beforeGlb.retainedBufferViewSha256,
  );
  assert.deepEqual(afterGlb, {
    byteLength: after.glb.length,
    images: 0,
    textures: 0,
    materials: 1,
    vertices: 12,
    triangles: 6,
    semantics: ["NORMAL", "POSITION", "_BATCHID"],
    dracoSemantics: ["NORMAL", "POSITION", "_BATCHID"],
    retainedBufferViewSha256: beforeGlb.retainedBufferViewSha256,
    extensionsUsed: ["KHR_draco_mesh_compression"],
    extensionsRequired: ["KHR_draco_mesh_compression"],
  });
});

test("colour variants preserve geometry while retaining only broad colour evidence", async () => {
  const image = await sharp({
    create: {
      width: 32,
      height: 24,
      channels: 3,
      background: { r: 48, g: 112, b: 176 },
    },
  })
    .png()
    .toBuffer();
  const source = b3dmFixture(image);
  const sourceParts = readB3dm(source);
  const sourceGlb = inspectGlb(sourceParts.glb);
  for (const [variant, output] of [
    ["dominant", await makeBackgroundDominantColor(source)],
    [
      "texture-lite",
      await makeBackgroundTextureLite(source, {
        maximumDimension: 16,
        quality: 50,
        blurSigma: 1,
      }),
    ],
  ]) {
    const outputParts = readB3dm(output);
    const outputGlb = inspectGlb(outputParts.glb);
    assert.deepEqual(b3dmIdentity(outputParts), b3dmIdentity(sourceParts));
    assert.equal(outputGlb.triangles, sourceGlb.triangles, variant);
    assert.equal(
      outputGlb.retainedBufferViewSha256,
      sourceGlb.retainedBufferViewSha256,
      variant,
    );
    assert.ok(
      outputGlb.extensionsRequired.includes("KHR_draco_mesh_compression"),
      variant,
    );
    assert.equal(outputGlb.images, variant === "dominant" ? 0 : 1, variant);
  }
});

test("texture-lite retains meaningful alpha with PNG and never enlarges small textures", async () => {
  const alphaSource = await syntheticTile({
    colour: { r: 190, g: 60, b: 40, alpha: 0.4 },
    dimensions: [24, 12],
  });
  const output = await makeBackgroundTextureLite(alphaSource, {
    maximumDimension: 128,
    quality: 55,
    blurSigma: 0,
    preserveSourceColour: true,
  });
  const [image] = embeddedImages(output);
  assert.equal(image.mimeType, "image/png");
  const metadata = await sharp(image.bytes).metadata();
  assert.deepEqual([metadata.width, metadata.height], [24, 12]);
  assert.equal(metadata.hasAlpha, true);
  const stats = await sharp(image.bytes).stats();
  assert.ok(stats.channels[3].mean < 255);
});

test("texture-lite downsizes base colour, preserves broad colour, and keeps non-colour maps byte-identical", async () => {
  const source = await syntheticTile({
    colour: { r: 35, g: 145, b: 205, alpha: 1 },
    dimensions: [320, 160],
    otherTexture: true,
  });
  const sourceImages = embeddedImages(source);
  const output = await makeBackgroundTextureLite(source, {
    maximumDimension: 128,
    quality: 55,
    blurSigma: 0,
    preserveSourceColour: true,
  });
  const outputImages = embeddedImages(output);
  assert.equal(outputImages[0].mimeType, "image/jpeg");
  assert.deepEqual(
    [
      (await sharp(outputImages[0].bytes).metadata()).width,
      (await sharp(outputImages[0].bytes).metadata()).height,
    ],
    [128, 64],
  );
  const colour = await sharp(outputImages[0].bytes).removeAlpha().stats();
  assert.ok(Math.abs(colour.channels[0].mean - 35) <= 8);
  assert.ok(Math.abs(colour.channels[1].mean - 145) <= 8);
  assert.ok(Math.abs(colour.channels[2].mean - 205) <= 8);
  assert.deepEqual(outputImages[1].bytes, sourceImages[1].bytes);
  assert.equal(outputImages[1].mimeType, "image/png");
});

test("texture-lite expands grayscale base colour to RGB before colour correction", async () => {
  const source = await syntheticTile({
    colour: { r: 71, g: 71, b: 71, alpha: 1 },
    dimensions: [513, 65],
    grayscale: true,
    imageMimeType: "image/jpeg",
  });
  const sourceParts = readB3dm(source);
  const sourceGlb = inspectGlb(sourceParts.glb);
  const output = await makeBackgroundTextureLite(source, {
    maximumDimension: 128,
    quality: 55,
    blurSigma: 0,
    preserveSourceColour: true,
  });
  const [image] = embeddedImages(output);
  const metadata = await sharp(image.bytes).metadata();
  const stats = await sharp(image.bytes).stats();
  assert.equal(image.mimeType, "image/jpeg");
  assert.equal(metadata.channels, 3);
  assert.equal(stats.channels.length, 3);
  for (const channel of stats.channels)
    assert.ok(Math.abs(channel.mean - 71) <= 8);
  const outputParts = readB3dm(output);
  const outputGlb = inspectGlb(outputParts.glb);
  assert.deepEqual(b3dmIdentity(outputParts), b3dmIdentity(sourceParts));
  assert.equal(outputGlb.vertices, sourceGlb.vertices);
  assert.equal(outputGlb.triangles, sourceGlb.triangles);
  assert.equal(
    outputGlb.retainedBufferViewSha256,
    sourceGlb.retainedBufferViewSha256,
  );
});

test("ambiguous texture ownership fails instead of encoding a non-colour map as JPEG", async () => {
  const ambiguous = await syntheticTile({ ambiguousTexture: true });
  await assert.rejects(
    makeBackgroundTextureLite(ambiguous),
    /ambiguous base-colour and non-colour semantics/u,
  );
});

test("mixed highlighted and background identities remain together and unchanged", async () => {
  const source = await syntheticTile({
    ids: ["highlighted-building", "background-building"],
    names: ["Highlighted", "Background"],
  });
  const output = await makeBackgroundTextureLite(source);
  assert.deepEqual(
    b3dmIdentity(readB3dm(output)),
    b3dmIdentity(readB3dm(source)),
  );
});
