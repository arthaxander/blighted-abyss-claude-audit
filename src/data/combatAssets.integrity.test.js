import fs from "fs";
import path from "path";
import {
  ABILITY_ICONS,
  ALLY_PORTRAITS,
  COMBAT_ART_FALLBACKS,
  COMBAT_ITEM_ICONS,
  ENEMY_PORTRAITS,
  PLAYER_PORTRAITS,
} from "./combatAssets";

const REPO_ROOT = path.resolve(__dirname, "../..");
const PUBLIC_ROOT = path.join(REPO_ROOT, "public");
const ASSET_ROOT = path.join(PUBLIC_ROOT, "assets");

const PENDING_COMBAT_ASSETS = Object.freeze({
  "planned-fallback": [
    "/assets/combat/fallbacks/ability.webp",
    "/assets/combat/fallbacks/ally.webp",
    "/assets/combat/fallbacks/enemy.webp",
    "/assets/combat/fallbacks/item.webp",
    "/assets/combat/fallbacks/player.webp",
  ],
  "planned-defender-ability-art": [
    "/assets/combat/abilities/defender/iron_counter.webp",
  ],
});

// Historical saves may still contain this exact URL. Remove the exemption only
// after those saved portrait paths have a migration.
const MALFORMED_FILENAME_EXCEPTIONS = Object.freeze([
  "/assets/portraits/placeholder.webp.webp",
]);

const normalizePublicUrlPath = (assetUrl, publicUrl = process.env.PUBLIC_URL || "") => {
  const pathname = new URL(assetUrl, "https://asset-integrity.invalid").pathname;
  const publicPath = publicUrl
    ? new URL(publicUrl, "https://asset-integrity.invalid").pathname.replace(/\/$/, "")
    : "";
  const withoutPrefix = publicPath && pathname.startsWith(`${publicPath}/`)
    ? pathname.slice(publicPath.length)
    : pathname;
  return `/${withoutPrefix.replace(/^\/+/, "")}`;
};

const resolvePublicAssetPath = (assetUrl, publicUrl) => {
  const relativePath = normalizePublicUrlPath(assetUrl, publicUrl).replace(/^\/+/, "");
  const resolved = path.resolve(PUBLIC_ROOT, relativePath.split("/").join(path.sep));
  const relativeToPublic = path.relative(PUBLIC_ROOT, resolved);
  if (relativeToPublic.startsWith("..") || path.isAbsolute(relativeToPublic)) {
    throw new Error(`Asset URL escapes public/: ${assetUrl}`);
  }
  return resolved;
};

const manifestEntries = Object.entries({
  COMBAT_ART_FALLBACKS,
  ENEMY_PORTRAITS,
  PLAYER_PORTRAITS,
  ABILITY_ICONS,
  COMBAT_ITEM_ICONS,
  ALLY_PORTRAITS,
}).flatMap(([category, entries]) => Object.entries(entries).map(([key, url]) => ({
  category,
  key,
  url,
  normalizedUrl: normalizePublicUrlPath(url),
  filePath: resolvePublicAssetPath(url),
})));

const pendingByPath = new Map(
  Object.entries(PENDING_COMBAT_ASSETS).flatMap(([reason, urls]) => (
    urls.map(url => [url, reason])
  ))
);

const walkFiles = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const entryPath = path.join(directory, entry.name);
  return entry.isDirectory() ? walkFiles(entryPath) : [entryPath];
});

const toPublicUrl = filePath => `/${path.relative(PUBLIC_ROOT, filePath).split(path.sep).join("/")}`;

const formatManifestEntry = entry => (
  `${entry.category}.${entry.key} -> ${entry.normalizedUrl} -> ${path.relative(REPO_ROOT, entry.filePath)}`
);

const integritySummary = Object.freeze({
  references: manifestEntries.length,
  physicallyPresent: manifestEntries.filter(entry => fs.existsSync(entry.filePath)).length,
  intentionallyPending: pendingByPath.size,
  malformedFilenameExceptions: MALFORMED_FILENAME_EXCEPTIONS.length,
});

describe("combat asset filesystem integrity", () => {
  test("resolves public URLs without browser APIs", () => {
    expect(resolvePublicAssetPath("/assets/combat/abilities/shared/attack.webp"))
      .toBe(path.join(PUBLIC_ROOT, "assets/combat/abilities/shared/attack.webp"));
    expect(resolvePublicAssetPath(
      "/mini-app/assets/combat/abilities/shared/attack.webp?cache=1#preview",
      "/mini-app/"
    )).toBe(path.join(PUBLIC_ROOT, "assets/combat/abilities/shared/attack.webp"));
  });

  test("every missing manifest file has a current, exact pending exception", () => {
    const referencedPaths = new Set(manifestEntries.map(entry => entry.normalizedUrl));
    const unexpectedMissing = manifestEntries.filter(entry => (
      !fs.existsSync(entry.filePath) && !pendingByPath.has(entry.normalizedUrl)
    ));
    const stalePending = [...pendingByPath].filter(([url]) => !referencedPaths.has(url));
    const fulfilledPending = [...pendingByPath].filter(([url]) => (
      fs.existsSync(resolvePublicAssetPath(url))
    ));
    const failures = [];

    if (unexpectedMissing.length) {
      failures.push("Missing and not allowlisted:\n" + unexpectedMissing.map(formatManifestEntry).join("\n"));
    }
    if (stalePending.length) {
      failures.push("Allowlisted but no longer referenced:\n" + stalePending
        .map(([url, reason]) => `${reason}: ${url}`)
        .join("\n"));
    }
    if (fulfilledPending.length) {
      failures.push("Now present; remove from pending allowlist:\n" + fulfilledPending
        .map(([url, reason]) => `${reason}: ${url}`)
        .join("\n"));
    }

    expect(failures.join("\n\n")).toBe("");
  });

  test("asset filenames do not contain accidental duplicate image extensions", () => {
    const malformedPattern = /\.(webp|png|jpe?g)\.\1$/i;
    const malformedFiles = walkFiles(ASSET_ROOT)
      .map(toPublicUrl)
      .filter(url => malformedPattern.test(url));
    const exceptionSet = new Set(MALFORMED_FILENAME_EXCEPTIONS);
    const unexpectedMalformed = malformedFiles.filter(url => !exceptionSet.has(url));
    const staleExceptions = MALFORMED_FILENAME_EXCEPTIONS.filter(url => !malformedFiles.includes(url));

    expect({ unexpectedMalformed, staleExceptions }).toEqual({
      unexpectedMalformed: [],
      staleExceptions: [],
    });
  });

  test("reports the current manifest coverage", () => {
    expect(integritySummary.references).toBe(
      integritySummary.physicallyPresent + integritySummary.intentionallyPending
    );
    console.info(
      `[combat asset integrity] references=${integritySummary.references}`,
      `present=${integritySummary.physicallyPresent}`,
      `pending=${integritySummary.intentionallyPending}`,
      `malformed-exceptions=${integritySummary.malformedFilenameExceptions}`
    );
  });
});
