import sharp from "sharp";

import {
  buildGlb,
  glbChunks,
  paddedChunk,
  readB3dm,
  remapBufferViewReferences,
  writeB3dm,
} from "./background-lite-b3dm-container.mjs";

export async function makeBackgroundLite(sourceBytes) {
  const parts = readB3dm(sourceBytes);
  const { json, binary } = glbChunks(parts.glb);
  const imageViews = new Set(
    (json.images ?? [])
      .map(({ bufferView }) => bufferView)
      .filter(Number.isInteger),
  );
  const remap = new Map();
  const bufferViews = [];
  const binaryParts = [];
  let byteOffset = 0;
  for (const [index, view] of (json.bufferViews ?? []).entries()) {
    if (imageViews.has(index)) continue;
    const start = view.byteOffset ?? 0;
    const bytes = binary.subarray(start, start + view.byteLength);
    const aligned = paddedChunk(bytes, 0);
    remap.set(index, bufferViews.length);
    bufferViews.push({ ...view, byteOffset });
    binaryParts.push(aligned);
    byteOffset += aligned.length;
  }
  delete json.images;
  delete json.textures;
  delete json.samplers;
  json.bufferViews = bufferViews;
  json.buffers = [{ ...(json.buffers?.[0] ?? {}), byteLength: byteOffset }];
  json.materials = [
    {
      name: "background-lite-neutral",
      pbrMetallicRoughness: {
        baseColorFactor: [122 / 255, 133 / 255, 136 / 255, 1],
        metallicFactor: 0,
        roughnessFactor: 1,
      },
    },
  ];
  for (const mesh of json.meshes ?? [])
    for (const primitive of mesh.primitives ?? []) {
      primitive.material = 0;
      for (const semantic of Object.keys(primitive.attributes ?? {}))
        if (semantic.startsWith("TEXCOORD_"))
          delete primitive.attributes[semantic];
      const dracoAttributes =
        primitive.extensions?.KHR_draco_mesh_compression?.attributes;
      for (const semantic of Object.keys(dracoAttributes ?? {}))
        if (semantic.startsWith("TEXCOORD_")) delete dracoAttributes[semantic];
    }
  remapBufferViewReferences(json, remap, "glTF");
  return writeB3dm(parts, buildGlb(json, Buffer.concat(binaryParts)));
}

function imageBytes(json, binary, image) {
  const view = json.bufferViews?.[image.bufferView];
  if (!view)
    throw new Error(`Image buffer view ${image.bufferView} is missing`);
  const start = view.byteOffset ?? 0;
  return binary.subarray(start, start + view.byteLength);
}

async function dominantRgb(bytes) {
  const { data } = await sharp(bytes)
    .resize(1, 1, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return [data[0] / 255, data[1] / 255, data[2] / 255, 1];
}

function removeTextureSemantics(json) {
  for (const mesh of json.meshes ?? [])
    for (const primitive of mesh.primitives ?? []) {
      for (const semantic of Object.keys(primitive.attributes ?? {}))
        if (semantic.startsWith("TEXCOORD_"))
          delete primitive.attributes[semantic];
      const dracoAttributes =
        primitive.extensions?.KHR_draco_mesh_compression?.attributes;
      for (const semantic of Object.keys(dracoAttributes ?? {}))
        if (semantic.startsWith("TEXCOORD_")) delete dracoAttributes[semantic];
    }
}

function repackBufferViews(json, binary, replacements = new Map()) {
  const remap = new Map();
  const bufferViews = [];
  const binaryParts = [];
  let byteOffset = 0;
  for (const [index, view] of (json.bufferViews ?? []).entries()) {
    const replacement = replacements.get(index);
    if (replacement === null) continue;
    const start = view.byteOffset ?? 0;
    const bytes =
      replacement ?? binary.subarray(start, start + view.byteLength);
    const aligned = paddedChunk(bytes, 0);
    remap.set(index, bufferViews.length);
    bufferViews.push({
      ...view,
      byteOffset,
      byteLength: bytes.length,
      ...(replacement ? { target: undefined, byteStride: undefined } : {}),
    });
    binaryParts.push(aligned);
    byteOffset += aligned.length;
  }
  json.bufferViews = bufferViews;
  json.buffers = [{ ...(json.buffers?.[0] ?? {}), byteLength: byteOffset }];
  remapBufferViewReferences(json, remap, "glTF");
  return Buffer.concat(binaryParts);
}

export async function makeBackgroundDominantColor(sourceBytes) {
  const parts = readB3dm(sourceBytes);
  const { json, binary } = glbChunks(parts.glb);
  const colours = await Promise.all(
    (json.images ?? []).map((image) =>
      dominantRgb(imageBytes(json, binary, image)),
    ),
  );
  for (const material of json.materials ?? []) {
    const pbr = (material.pbrMetallicRoughness ??= {});
    const textureIndex = pbr.baseColorTexture?.index;
    const imageIndex = Number.isInteger(textureIndex)
      ? json.textures?.[textureIndex]?.source
      : null;
    if (Number.isInteger(imageIndex) && colours[imageIndex])
      pbr.baseColorFactor = colours[imageIndex];
    delete pbr.baseColorTexture;
    delete pbr.metallicRoughnessTexture;
    delete material.normalTexture;
    delete material.occlusionTexture;
    delete material.emissiveTexture;
    pbr.metallicFactor = 0;
    pbr.roughnessFactor = 1;
  }
  const removedViews = new Set(
    (json.images ?? [])
      .map(({ bufferView }) => bufferView)
      .filter(Number.isInteger),
  );
  delete json.images;
  delete json.textures;
  delete json.samplers;
  removeTextureSemantics(json);
  const replacements = new Map([...removedViews].map((index) => [index, null]));
  const packedBinary = repackBufferViews(json, binary, replacements);
  return writeB3dm(parts, buildGlb(json, packedBinary));
}

async function averageSaturation(input, maximumDimension = 512) {
  const { data, info } = await sharp(input)
    .resize({
      width: maximumDimension,
      height: maximumDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels < 3) return 0;
  let total = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    if (maximum > 0) total += (maximum - minimum) / maximum;
  }
  return total / (data.length / info.channels);
}

async function normalizeGrayscale(input, { removeAlpha = false } = {}) {
  const metadata = await sharp(input).metadata();
  if (metadata.space !== "b-w" && (metadata.channels ?? 0) >= 3) return input;
  let pipeline = sharp(input);
  if (removeAlpha) pipeline = pipeline.removeAlpha();
  return pipeline.tint({ r: 255, g: 255, b: 255 }).png().toBuffer();
}

function textureImageIndex(json, textureInfo) {
  const textureIndex = textureInfo?.index;
  return Number.isInteger(textureIndex)
    ? json.textures?.[textureIndex]?.source
    : null;
}

function classifyTextureImages(json) {
  const baseColour = new Set();
  const other = new Set();
  for (const material of json.materials ?? []) {
    const pbr = material.pbrMetallicRoughness ?? {};
    const baseImage = textureImageIndex(json, pbr.baseColorTexture);
    if (Number.isInteger(baseImage)) baseColour.add(baseImage);
    for (const textureInfo of [
      pbr.metallicRoughnessTexture,
      material.normalTexture,
      material.occlusionTexture,
      material.emissiveTexture,
    ]) {
      const imageIndex = textureImageIndex(json, textureInfo);
      if (Number.isInteger(imageIndex)) other.add(imageIndex);
    }
  }
  return {
    baseColour,
    other,
    ambiguous: new Set([...baseColour].filter((index) => other.has(index))),
  };
}

export async function inspectTextureSemantics(sourceBytes) {
  const parts = readB3dm(sourceBytes);
  const { json, binary } = glbChunks(parts.glb);
  const usage = classifyTextureImages(json);
  const meaningfulAlphaImages = [];
  for (const imageIndex of usage.baseColour) {
    const stats = await sharp(
      imageBytes(json, binary, json.images[imageIndex]),
    ).stats();
    const alpha = stats.channels[3];
    if (alpha && alpha.min < 255) meaningfulAlphaImages.push(imageIndex);
  }
  return {
    imageCount: json.images?.length ?? 0,
    baseColourImages: [...usage.baseColour].sort((a, b) => a - b),
    preservedNonColourImages: [...usage.other].sort((a, b) => a - b),
    ambiguousImages: [...usage.ambiguous].sort((a, b) => a - b),
    meaningfulAlphaImages,
  };
}

export async function makeBackgroundTextureLite(
  sourceBytes,
  {
    maximumDimension = 128,
    quality = 55,
    blurSigma = 0,
    preserveSourceColour = true,
  } = {},
) {
  const parts = readB3dm(sourceBytes);
  const { json, binary } = glbChunks(parts.glb);
  const textureUsage = classifyTextureImages(json);
  if (textureUsage.ambiguous.size)
    throw new Error(
      `Images have ambiguous base-colour and non-colour semantics: ${[
        ...textureUsage.ambiguous,
      ].join(", ")}`,
    );
  const replacements = new Map();
  for (const [imageIndex, image] of (json.images ?? []).entries()) {
    if (!textureUsage.baseColour.has(imageIndex)) continue;
    const sourceImage = imageBytes(json, binary, image);
    const rgbSourceImage = preserveSourceColour
      ? await normalizeGrayscale(sourceImage, { removeAlpha: true })
      : sourceImage;
    const sourceStats = preserveSourceColour
      ? await sharp(rgbSourceImage).toColourspace("srgb").removeAlpha().stats()
      : null;
    const alphaStats = (await sharp(sourceImage).stats()).channels[3];
    const hasMeaningfulAlpha = Boolean(alphaStats && alphaStats.min < 255);
    const sourceSaturation = preserveSourceColour
      ? await averageSaturation(sourceImage)
      : null;
    let pipeline = sharp(await normalizeGrayscale(sourceImage))
      .toColourspace("srgb")
      .resize({
        width: maximumDimension,
        height: maximumDimension,
        fit: "inside",
        withoutEnlargement: true,
      });
    if (blurSigma > 0) pipeline = pipeline.blur(blurSigma);
    if (sourceStats) {
      const reduced = await pipeline.clone().png().toBuffer();
      const reducedRgb = await sharp(reduced).removeAlpha().png().toBuffer();
      const reducedStats = await sharp(reducedRgb).stats();
      const reducedSaturation = await averageSaturation(reducedRgb, 128);
      const offsets = [0, 1, 2].map((channel) =>
        Math.max(
          -32,
          Math.min(
            32,
            sourceStats.channels[channel].mean -
              reducedStats.channels[channel].mean,
          ),
        ),
      );
      pipeline = sharp(reducedRgb).linear([1, 1, 1], offsets);
      if (reducedSaturation > 0.001)
        pipeline = pipeline.modulate({
          saturation: Math.max(
            1,
            Math.min(2.5, sourceSaturation / reducedSaturation),
          ),
        });
      if (hasMeaningfulAlpha) {
        const alpha = await sharp(reduced).extractChannel("alpha").toBuffer();
        pipeline = pipeline.joinChannel(alpha);
      }
    }
    const processed = await (
      hasMeaningfulAlpha
        ? pipeline.png({ compressionLevel: 9, adaptiveFiltering: true })
        : pipeline.jpeg({ quality, chromaSubsampling: "4:4:4", mozjpeg: true })
    ).toBuffer();
    replacements.set(image.bufferView, processed);
    image.mimeType = hasMeaningfulAlpha ? "image/png" : "image/jpeg";
  }
  for (const material of json.materials ?? []) {
    const pbr = (material.pbrMetallicRoughness ??= {});
    pbr.metallicFactor = 0;
    pbr.roughnessFactor = 1;
  }
  const packedBinary = repackBufferViews(json, binary, replacements);
  return writeB3dm(parts, buildGlb(json, packedBinary));
}
