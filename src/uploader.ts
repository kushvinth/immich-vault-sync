import { App, Notice, TFile } from "obsidian";
import { buildAssetUrl, ImmichClient, normalizeImmichUrl } from "./immich";
import type { PluginSettings, UploadRecord } from "./settings";
import { replaceWikiLinks } from "./link-rewriter";
import { updateImmichDashboard } from "./dashboard";

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "avif",
  "heic",
  "heif",
  "bmp",
  "tiff",
  "tif",
]);

const LOG_PREFIX = "[Immich]";
const CACHE_FILE_NAME = "upload-cache.json";
const DEFAULT_IMAGE_FOLDER = "Meta/Media";
const CACHE_VERSION = 2;
const DASHBOARD_FOLDER_PREFIX = "Meta/Media/Asserts-Base-Data/";

function log(message: string, details?: unknown) {
  if (details === undefined) {
    console.debug(`${LOG_PREFIX} ${message}`);
    return;
  }
  console.debug(`${LOG_PREFIX} ${message}`, details);
}

export async function uploadFolderImages(
  app: App,
  settings: PluginSettings,
  saveSettings: () => Promise<void>,
): Promise<void> {
  const issues = validateSettings(settings);
  if (issues.length > 0) {
    console.warn(`${LOG_PREFIX} Missing settings`, issues);
    new Notice(`Immich settings missing: ${issues.join(", ")}`);
    return;
  }

  log("Starting upload", {
    immichUrl: settings.immichUrl,
    albumName: settings.albumName,
    albumId: settings.albumId || "(auto)",
    imageFolder: settings.imageFolder,
    linkStyle: settings.linkStyle,
    hasApiKey: Boolean(settings.immichApiKey),
    hasShareKey: Boolean(settings.albumShareKey),
  });

  const baseUrl = normalizeImmichUrl(settings.immichUrl);
  const client = new ImmichClient(settings);
  const albumId = await client.ensureAlbum();
  log(`Using album: ${albumId}`);
  if (albumId !== settings.albumId) {
    settings.albumId = albumId;
    await saveSettings();
  }

  const targetImageFolder = normalizeFolderPath(settings.imageFolder);
  const scan = collectImages(app, targetImageFolder);
  log("Vault scan", scan.stats);
  if (scan.stats.allImagePaths.length > 0) {
    log("All image paths in image folder", scan.stats.allImagePaths);
  }
  if (scan.stats.samplePaths.length > 0) {
    log("Sample image paths", scan.stats.samplePaths);
  }

  if (scan.files.length === 0) {
    if (!scan.stats.folderExists) {
      new Notice(`Image folder not found: ${targetImageFolder}`);
    } else if (scan.stats.totalImages === 0) {
      new Notice(`No images found in ${targetImageFolder}.`);
    } else {
      new Notice(`No supported images were found in ${targetImageFolder}.`);
    }
    return;
  }

  const files = scan.files;
  log(`Found ${files.length} image(s) in ${targetImageFolder}`);

  new Notice(`Uploading ${files.length} image(s) to Immich...`);

  const cachedAssets = await readUploadCache(app);
  const uploadedAssets: Record<string, UploadRecord> = {
    ...(settings.uploadedAssets ?? {}),
    ...cachedAssets,
  };
  const updatedAssets: Record<string, UploadRecord> = { ...uploadedAssets };
  let uploadedCount = 0;
  let skippedCount = 0;
  let albumAddFailedCount = 0;
  let failedCount = 0;
  const failedFiles: string[] = [];

  for (const file of files) {
    const nowIso = new Date().toISOString();
    const existing = uploadedAssets[file.path];
    const isHealthyCached =
      Boolean(existing?.assetId) &&
      Boolean(existing?.url) &&
      existing?.status !== "error" &&
      existing?.mtime === file.stat.mtime &&
      (existing?.fileSize ?? file.stat.size) === file.stat.size;
    if (isHealthyCached && existing) {
      log(`Skipping unchanged file: ${file.path}`);
      updatedAssets[file.path] = {
        ...existing,
        status: existing.status ?? "uploaded",
        fileName: file.name,
        fileSize: file.stat.size,
        lastAttemptAt: nowIso,
      };
      skippedCount += 1;
      continue;
    }

    try {
      log(`Uploading file: ${file.path}`);
      const data = await app.vault.readBinary(file);
      const uploadResult = await client.uploadAsset(file, data);
      log(`Uploaded asset: ${uploadResult.id}`, { status: uploadResult.status });

      const url = buildAssetUrl(baseUrl, uploadResult.id, settings.albumShareKey, settings.linkStyle);
      updatedAssets[file.path] = {
        assetId: uploadResult.id,
        mtime: file.stat.mtime,
        url,
        status: uploadResult.status === "duplicate" ? "duplicate" : "uploaded",
        fileName: file.name,
        fileSize: file.stat.size,
        lastAttemptAt: nowIso,
        lastUploadedAt: nowIso,
        lastError: "",
      };
      uploadedCount += 1;

      try {
        await client.addAssetToAlbum(albumId, uploadResult.id);
        log(`Added asset to album: ${albumId}`);
      } catch (albumError) {
        albumAddFailedCount += 1;
        console.error(`[Immich] Uploaded but failed to add to album ${file.path}`, albumError);
      }
    } catch (error) {
      failedCount += 1;
      failedFiles.push(file.path);
      const message = error instanceof Error ? error.message : String(error);
      updatedAssets[file.path] = {
        assetId: existing?.assetId ?? "",
        mtime: existing?.mtime ?? file.stat.mtime,
        url: existing?.url ?? "",
        status: "error",
        fileName: file.name,
        fileSize: file.stat.size,
        lastAttemptAt: nowIso,
        lastUploadedAt: existing?.lastUploadedAt ?? "",
        lastError: message,
      };
      console.error(`[Immich] Failed to upload ${file.path}`, error);
    }
  }

  settings.uploadedAssets = updatedAssets;
  await saveSettings();
  await writeUploadCache(app, updatedAssets);
  await updateImmichDashboard(app, updatedAssets);

  const assetUrlMap = new Map<string, string>();
  for (const file of files) {
    const record = updatedAssets[file.path];
    if (record?.url) {
      assetUrlMap.set(file.path, record.url);
    }
  }

  const filteredReplaceResult = await replaceWikiLinks(
    app,
    assetUrlMap,
    undefined,
    DASHBOARD_FOLDER_PREFIX,
  );
  log("Link replacement complete", filteredReplaceResult);

  const parts = [
    `Upload complete: ${uploadedCount} uploaded`,
    `${skippedCount} skipped`,
    `${failedCount} failed`,
  ];
  if (albumAddFailedCount > 0) {
    parts.push(`${albumAddFailedCount} not added to album`);
  }
  parts.push(
    `Updated ${filteredReplaceResult.filesUpdated} file(s), ${filteredReplaceResult.linksReplaced} link(s).`,
  );
  new Notice(parts.join(". ") + (failedFiles.length > 0 ? " Check console for failed file list." : ""));
  log("Upload workflow finished", {
    uploaded: uploadedCount,
    skipped: skippedCount,
    failed: failedCount,
    albumAddFailed: albumAddFailedCount,
    failedFiles,
    filesUpdated: filteredReplaceResult.filesUpdated,
    linksReplaced: filteredReplaceResult.linksReplaced,
  });
}

function validateSettings(settings: PluginSettings): string[] {
  const missing: string[] = [];
  if (!settings.immichUrl.trim()) {
    missing.push("Immich URL");
  }
  if (!settings.immichApiKey.trim()) {
    missing.push("API key");
  }
  if (!settings.albumShareKey.trim()) {
    missing.push("album share key");
  }
  if (!settings.albumId.trim() && !settings.albumName.trim()) {
    missing.push("album name or ID");
  }
  if (!normalizeFolderPath(settings.imageFolder)) {
    missing.push("image folder");
  }
  return missing;
}

function normalizeFolderPath(value: string): string {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
  return trimmed || DEFAULT_IMAGE_FOLDER;
}

type ScanStats = {
  folderPath: string;
  folderExists: boolean;
  totalFiles: number;
  totalImages: number;
  samplePaths: string[];
  allImagePaths: string[];
};

function collectImages(app: App, folderPath: string): { files: TFile[]; stats: ScanStats } {
  const allFiles = app.vault.getFiles();
  const prefix = `${folderPath}/`;
  const filesInTargetFolder = allFiles.filter(
    (file) => file.path === folderPath || file.path.startsWith(prefix),
  );
  const isImage = (file: TFile): boolean => IMAGE_EXTENSIONS.has(getExtension(file));
  const totalFiles = filesInTargetFolder.length;
  const allImages = filesInTargetFolder.filter(isImage);
  const folderExists = app.vault.getAbstractFileByPath(folderPath) !== null;

  return {
    files: allImages,
    stats: {
      folderPath,
      folderExists,
      totalFiles,
      totalImages: allImages.length,
      samplePaths: allImages.slice(0, 5).map((file) => file.path),
      allImagePaths: allImages.map((file) => file.path),
    },
  };
}

type UploadCacheData = {
  version: number;
  updatedAt: string;
  assets: Record<string, UploadRecord>;
};

async function readUploadCache(app: App): Promise<Record<string, UploadRecord>> {
  const cacheFilePath = `${app.vault.configDir}/plugins/immich/${CACHE_FILE_NAME}`;
  try {
    const exists = await app.vault.adapter.exists(cacheFilePath);
    if (!exists) {
      return {};
    }

    const raw = await app.vault.adapter.read(cacheFilePath);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const cacheData = parsed as Partial<UploadCacheData>;
    if (cacheData.assets && typeof cacheData.assets === "object" && !Array.isArray(cacheData.assets)) {
      return cacheData.assets;
    }
    return parsed as Record<string, UploadRecord>;
  } catch (error) {
    console.warn(`${LOG_PREFIX} Failed to read upload cache`, error);
    return {};
  }
}

async function writeUploadCache(app: App, cache: Record<string, UploadRecord>): Promise<void> {
  const cacheFilePath = `${app.vault.configDir}/plugins/immich/${CACHE_FILE_NAME}`;
  try {
    const payload: UploadCacheData = {
      version: CACHE_VERSION,
      updatedAt: new Date().toISOString(),
      assets: cache,
    };
    await app.vault.adapter.write(cacheFilePath, JSON.stringify(payload, null, 2));
  } catch (error) {
    console.warn(`${LOG_PREFIX} Failed to write upload cache`, error);
  }
}

function getExtension(file: TFile): string {
  if (file.extension) {
    return file.extension.toLowerCase();
  }

  const parts = file.name.split(".");
  if (parts.length <= 1) {
    return "";
  }

  const ext = parts.at(-1);
  return ext ? ext.toLowerCase() : "";
}
