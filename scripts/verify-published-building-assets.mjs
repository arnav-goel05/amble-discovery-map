#!/usr/bin/env node

import descriptor from "../data/building-asset-release.json" with { type: "json" };
import { verifyPublishedBuildingRelease } from "./lib/building-release-publish.mjs";

const report = await verifyPublishedBuildingRelease({
  descriptor,
  origin: process.env.BUILDING_ASSET_ORIGIN ?? "https://amblefinds.com",
});
console.log(JSON.stringify(report, null, 2));
