import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  b3dmIdentity,
  inspectGlb,
  makeBackgroundDominantColor,
  makeBackgroundTextureLite,
  readB3dm,
} from "./lib/background-lite-b3dm.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pilotRoot = path.join(ROOT, "outputs/background-lite-pilot/round1-20");
const outputRoot = path.join(pilotRoot, "color-variants");
const manifest = JSON.parse(
  fs.readFileSync(path.join(pilotRoot, "manifest.json"), "utf8"),
);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

const variants = [
  {
    id: "dominant-color",
    transform: makeBackgroundDominantColor,
    description: "Per-original-material average colour with no image textures",
  },
  {
    id: "texture-lite-128",
    transform: (bytes) =>
      makeBackgroundTextureLite(bytes, {
        maximumDimension: 128,
        quality: 55,
        blurSigma: 0,
        preserveSourceColour: true,
      }),
    description:
      "Colour-preserved JPEG textures bounded to 128 pixels at quality 55",
  },
];

const report = {
  schemaVersion: "background-color-variants-v1",
  generatedAt: new Date().toISOString(),
  sourceManifest: "outputs/background-lite-pilot/round1-20/manifest.json",
  productionChanged: false,
  variants: [],
};

for (const variant of variants) {
  const records = [];
  for (const sourceRecord of manifest.records) {
    const sourceBytes = fs.readFileSync(path.join(ROOT, sourceRecord.source));
    const sourceParts = readB3dm(sourceBytes, sourceRecord.source);
    const sourceIdentity = b3dmIdentity(sourceParts);
    const sourceGlb = inspectGlb(sourceParts.glb);
    const outputBytes = await variant.transform(sourceBytes);
    const outputParts = readB3dm(outputBytes, sourceRecord.source);
    const outputIdentity = b3dmIdentity(outputParts);
    const outputGlb = inspectGlb(outputParts.glb);
    const identityPreserved =
      JSON.stringify(sourceIdentity) === JSON.stringify(outputIdentity);
    const geometryPreserved =
      sourceGlb.triangles === outputGlb.triangles &&
      sourceGlb.retainedBufferViewSha256 === outputGlb.retainedBufferViewSha256;
    if (!identityPreserved || !geometryPreserved)
      throw new Error(
        `${variant.id}/${sourceRecord.source}: integrity changed`,
      );
    if (!outputGlb.extensionsRequired.includes("KHR_draco_mesh_compression"))
      throw new Error(`${variant.id}/${sourceRecord.source}: Draco was lost`);
    if (
      variant.id === "dominant-color" &&
      (outputGlb.images || outputGlb.textures)
    )
      throw new Error(`${variant.id}/${sourceRecord.source}: textures remain`);

    const relative = sourceRecord.source.replace(/^optimized-tiles\//u, "");
    const destination = path.join(outputRoot, variant.id, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, outputBytes);
    records.push({
      source: sourceRecord.source,
      output: path.relative(ROOT, destination).split(path.sep).join("/"),
      sourceBytes: sourceBytes.length,
      outputBytes: outputBytes.length,
      reductionPercent: Number(
        (
          ((sourceBytes.length - outputBytes.length) / sourceBytes.length) *
          100
        ).toFixed(2),
      ),
      sourceSha256: sha256(sourceBytes),
      outputSha256: sha256(outputBytes),
      identityPreserved,
      geometryPreserved,
      outputGlb,
    });
  }
  const totals = records.reduce(
    (sum, record) => ({
      sourceBytes: sum.sourceBytes + record.sourceBytes,
      outputBytes: sum.outputBytes + record.outputBytes,
    }),
    { sourceBytes: 0, outputBytes: 0 },
  );
  totals.reductionPercent = Number(
    (
      ((totals.sourceBytes - totals.outputBytes) / totals.sourceBytes) *
      100
    ).toFixed(2),
  );
  report.variants.push({
    id: variant.id,
    description: variant.description,
    totals,
    records,
  });

  const tileset = JSON.parse(
    fs.readFileSync(path.join(pilotRoot, "lite-tileset.json"), "utf8"),
  );
  for (const child of tileset.root.children ?? []) {
    const relative = child.content.uri.replace(/^lite\//u, "");
    child.content.uri = `${variant.id}/${relative}`;
  }
  fs.writeFileSync(
    path.join(outputRoot, `${variant.id}-tileset.json`),
    `${JSON.stringify(tileset, null, 2)}\n`,
  );
  console.log(`${variant.id}: ${totals.sourceBytes} -> ${totals.outputBytes}`);
}

fs.writeFileSync(
  path.join(outputRoot, "report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
