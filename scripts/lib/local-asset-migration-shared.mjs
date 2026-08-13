import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  lstat,
  mkdir,
  opendir,
  readFile,
  realpath,
  rename,
  rm,
  statfs,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export const MIGRATION_SCHEMA = "local-building-asset-migration-v1";
export const TOKEN_SCHEMA = "local-building-asset-confirmation-v1";
export const RECLAIM_ACTION = "reclaim-optimized-tiles";
export const LEGACY_CLEANUP_ACTION = "reclaim-legacy-poi-tiles";
export const SWITCH_SCHEMA = "local-building-assets-v1";
export const DEFAULT_TOKEN_TTL_MS = 15 * 60 * 1_000;
export const MAX_TOKEN_TTL_MS = 60 * 60 * 1_000;

export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");
export const numeric = (value) =>
  typeof value === "bigint" ? Number(value) : value;
export const missing = (error) => error?.code === "ENOENT";

const canonicalEntry = (relativePath, stat) =>
  [
    relativePath,
    stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "special",
    stat.size,
    stat.blocks,
    stat.dev,
    stat.ino,
    stat.mtimeNs,
  ]
    .map(String)
    .join("\0");

export const inventoryDirectory = async (directory) => {
  const rootStat = await lstat(directory, { bigint: true });
  if (rootStat.isSymbolicLink()) throw new Error(`${directory} is a symlink`);
  if (!rootStat.isDirectory())
    throw new Error(`${directory} is not a directory`);

  const entries = [];
  const counters = {
    allocatedBytes: numeric(rootStat.blocks) * 512,
    directoryCount: 1,
    logicalBytes: 0,
    regularFileCount: 0,
    specialEntryCount: 0,
    symlinkCount: 0,
  };
  const visit = async (absoluteDirectory, relativeDirectory = "") => {
    const handle = await opendir(absoluteDirectory);
    const names = [];
    for await (const entry of handle) names.push(entry.name);
    names.sort((left, right) => left.localeCompare(right));
    for (const name of names) {
      const absolutePath = path.join(absoluteDirectory, name);
      const relativePath = path.posix.join(
        relativeDirectory.split(path.sep).join(path.posix.sep),
        name,
      );
      const stat = await lstat(absolutePath, { bigint: true });
      if (stat.isSymbolicLink()) {
        counters.symlinkCount += 1;
        entries.push(`${relativePath}\0symlink`);
        continue;
      }
      counters.allocatedBytes += numeric(stat.blocks) * 512;
      entries.push(canonicalEntry(relativePath, stat));
      if (stat.isDirectory()) {
        counters.directoryCount += 1;
        await visit(absolutePath, relativePath);
      } else if (stat.isFile()) {
        counters.regularFileCount += 1;
        counters.logicalBytes += numeric(stat.size);
      } else counters.specialEntryCount += 1;
    }
  };
  await visit(directory);
  return {
    ...counters,
    device: numeric(rootStat.dev),
    inode: numeric(rootStat.ino),
    inventoryId: `sha256:${sha256(entries.join("\n"))}`,
    path: directory,
  };
};

export const validateTileset = async (sourcePath) => {
  const tilesetPath = path.join(sourcePath, "tileset.json");
  try {
    const bytes = await readFile(tilesetPath);
    const parsed = JSON.parse(bytes.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || !parsed.root)
      throw new Error("tileset.json must contain an object root");
    return { sha256: `sha256:${sha256(bytes)}`, tilesetPath, valid: true };
  } catch (error) {
    return { error: error.message, tilesetPath, valid: false };
  }
};

export const filesystemCapacity = async (directory) => {
  const result = await statfs(directory, { bigint: true });
  const blockSize = numeric(result.bsize);
  return {
    availableBytes: numeric(result.bavail) * blockSize,
    filesystemBytes: numeric(result.blocks) * blockSize,
  };
};

export const exactPaths = async ({ repositoryRoot, targetPath }) => {
  const blockers = [];
  if (!path.isAbsolute(repositoryRoot))
    return { blockers: ["repository-root-not-absolute"] };
  let resolvedRepositoryRoot;
  try {
    resolvedRepositoryRoot = await realpath(repositoryRoot);
  } catch {
    return { blockers: ["repository-root-missing"] };
  }
  const sourcePath = path.join(resolvedRepositoryRoot, "tiles");
  const expectedTargetPath = path.join(
    resolvedRepositoryRoot,
    "optimized-tiles",
  );
  if (!path.isAbsolute(targetPath)) blockers.push("target-not-absolute");
  if (targetPath !== path.normalize(targetPath))
    blockers.push("target-not-normalized");
  let resolvedRequestedTarget = null;
  if (path.isAbsolute(targetPath)) {
    try {
      const requestedStat = await lstat(targetPath);
      if (requestedStat.isSymbolicLink()) blockers.push("target-is-symlink");
      resolvedRequestedTarget = await realpath(targetPath);
    } catch (error) {
      if (!missing(error)) blockers.push("target-resolution-failed");
    }
  }
  const comparableTarget = resolvedRequestedTarget ?? path.resolve(targetPath);
  if (comparableTarget !== expectedTargetPath)
    blockers.push("target-is-not-exact-optimized-tiles");
  return {
    blockers,
    repositoryRoot: resolvedRepositoryRoot,
    sourcePath,
    targetPath: expectedTargetPath,
  };
};

export const encodeConfirmationToken = (claims) => {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `v1.${body}.${sha256(body)}`;
};

export const decodeConfirmationToken = (token) => {
  if (typeof token !== "string") return null;
  const [version, body, checksum, ...extra] = token.split(".");
  if (
    version !== "v1" ||
    !body ||
    !/^[a-f0-9]{64}$/.test(checksum) ||
    extra.length
  )
    return null;
  const expected = Buffer.from(sha256(body), "hex");
  const received = Buffer.from(checksum, "hex");
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  )
    return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return claims?.schema === TOKEN_SCHEMA ? claims : null;
  } catch {
    return null;
  }
};

export const baseResult = (operation) => ({
  schemaVersion: MIGRATION_SCHEMA,
  operation,
  localOnly: true,
  publicationActions: [],
});

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
};

export const atomicWriteJson = async (destination, value) => {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  try {
    await writeFile(
      temporary,
      `${JSON.stringify(canonical(value), null, 2)}\n`,
      {
        flag: "wx",
      },
    );
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
};

export const readJson = async (filename) =>
  JSON.parse(await readFile(filename, "utf8"));

export const resolveContainedFile = async ({ repositoryRoot, reference }) => {
  if (typeof reference !== "string" || reference.length === 0)
    throw new Error("asset path is missing");
  const absolute = path.isAbsolute(reference)
    ? path.normalize(reference)
    : path.resolve(repositoryRoot, reference);
  const stat = await lstat(absolute);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error(`asset path is not a regular file: ${reference}`);
  const [resolvedRoot, resolvedFile] = await Promise.all([
    realpath(repositoryRoot),
    realpath(absolute),
  ]);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error(`asset path escapes the repository: ${reference}`);
  return resolvedFile;
};

export const rejectedReclaim = (outcome, details = {}) => ({
  ...baseResult("reclaim"),
  ...details,
  outcome,
  state: "awaiting-confirmation",
});
