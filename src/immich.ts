import { Notice, requestUrl, type TFile } from "obsidian";
import type { PluginSettings, LinkStyle } from "./settings";

type UploadStatus = "created" | "duplicate";

export interface UploadResult {
  id: string;
  status: UploadStatus;
}

export function normalizeImmichUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function buildAssetUrl(baseUrl: string, assetId: string, shareKey: string, style: LinkStyle): string {
  const encodedKey = encodeURIComponent(shareKey);
  if (style === "preview") {
    return `${baseUrl}/api/assets/${assetId}/thumbnail?size=preview&key=${encodedKey}`;
  }
  return `${baseUrl}/api/assets/${assetId}/original?key=${encodedKey}`;
}

export class ImmichClient {
  private baseUrl: string;
  private readonly deviceId = "obsidian-immich-plugin";

  constructor(private settings: PluginSettings) {
    this.baseUrl = normalizeImmichUrl(settings.immichUrl);
  }

  updateSettings(settings: PluginSettings) {
    this.settings = settings;
    this.baseUrl = normalizeImmichUrl(settings.immichUrl);
  }

  async testConnection(): Promise<void> {
    const aboutUrl = `${this.baseUrl}/api/server/about`;
    debugLog("Testing connection", { url: aboutUrl });
    try {
      const result = (await requestUrl({
        url: aboutUrl,
        headers: this.authHeaders(),
      })) as RequestJsonResponse;

      debugLog("Connection response", { status: result.status });
      if (result.status === 200) {
        new Notice("Connection successful.");
        return;
      }
    } catch (error) {
      errorLog("Connection failed", error);
    }

    new Notice("Failed to connect to Immich. Check the console for details.");
  }

  async ensureAlbum(): Promise<string> {
    if (this.settings.albumId) {
      debugLog("Using configured album ID", { albumId: this.settings.albumId });
      const existing = await this.getAlbumById(this.settings.albumId);
      if (existing) {
        debugLog("Album found", { albumId: existing.id, albumName: existing.albumName });
        return existing.id;
      }
	      warnLog("Album ID not found, falling back to name lookup", {
        albumId: this.settings.albumId,
      });
    }

    debugLog("Looking up album by name", { albumName: this.settings.albumName });
    const byName = await this.findAlbumByName(this.settings.albumName);
    if (byName) {
	      debugLog("Album found", { albumId: byName.id, albumName: byName.albumName });
      return byName.id;
    }

	    debugLog("Creating album", { albumName: this.settings.albumName });
    const created = await this.createAlbum(this.settings.albumName);
	    debugLog("Album created", { albumId: created.id, albumName: created.albumName });
    return created.id;
  }

  async uploadAsset(file: TFile, data: ArrayBuffer): Promise<UploadResult> {
    const createdAt = new Date(file.stat.ctime).toISOString();
    const modifiedAt = new Date(file.stat.mtime).toISOString();
    const deviceAssetId = `${file.path}-${file.stat.mtime}`;

    debugLog("Uploading asset", {
      filename: file.name,
      path: file.path,
      size: file.stat.size,
    });

    const { body, boundary } = buildMultipartBody({
      fields: [
        { name: "deviceId", value: this.deviceId },
        { name: "deviceAssetId", value: deviceAssetId },
        { name: "fileCreatedAt", value: createdAt },
        { name: "fileModifiedAt", value: modifiedAt },
        { name: "isFavorite", value: "false" },
        { name: "filename", value: file.name },
      ],
      file: {
        fieldName: "assetData",
        filename: file.name,
        mimeType: guessMimeType(file.extension),
        data,
      },
    });

    let result;
    try {
      result = (await requestUrl({
        url: `${this.baseUrl}/api/assets`,
        method: "POST",
        headers: {
          ...this.authHeaders(),
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body: toArrayBuffer(body),
      })) as RequestJsonResponse;
    } catch (error) {
      errorLog("Upload request failed", {
        path: file.path,
        deviceAssetId,
        error,
      });
      throw error;
    }

      debugLog("Upload response", { status: result.status, assetId: extractUploadId(result.json) });

    const payload = parseUploadPayload(result.json);
    if (!payload?.id) {
      throw new Error(`Unexpected upload response (${result.status})`);
    }

    return payload;
  }

  async addAssetToAlbum(albumId: string, assetId: string): Promise<void> {
	    debugLog("Adding asset to album", { albumId, assetId });
    await requestUrl({
      url: `${this.baseUrl}/api/albums/${albumId}/assets`,
      method: "PUT",
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids: [assetId] }),
    });
  }

  private async findAlbumByName(name: string): Promise<{ id: string; albumName: string } | null> {
    debugLog("Fetching album list", { isOwned: true });
    const result = (await requestUrl({
      url: `${this.baseUrl}/api/albums?isOwned=true`,
      headers: this.authHeaders(),
    })) as RequestJsonResponse;

    if (!Array.isArray(result.json)) {
      return null;
    }

    for (const album of result.json) {
      if (isAlbumRecord(album) && album.albumName === name) {
        return album;
      }
    }

    return null;
  }

  private async getAlbumById(id: string): Promise<{ id: string; albumName: string } | null> {
    try {
	      debugLog("Fetching album by ID", { albumId: id });
      const result = (await requestUrl({
        url: `${this.baseUrl}/api/albums/${id}`,
        headers: this.authHeaders(),
      })) as RequestJsonResponse;

      if (result.status !== 200) {
        return null;
      }

      return isAlbumRecord(result.json) ? result.json : null;
    } catch {
      return null;
    }
  }

  private async createAlbum(name: string): Promise<{ id: string; albumName: string }>
  {
    const result = (await requestUrl({
      url: `${this.baseUrl}/api/albums`,
      method: "POST",
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ albumName: name }),
    })) as RequestJsonResponse;

	    debugLog("Create album response", { status: result.status, albumId: extractAlbumId(result.json) });

	    if (!isAlbumRecord(result.json)) {
      throw new Error("Failed to create Immich album");
    }

    return result.json;
  }

  private authHeaders(): Record<string, string> {
    return {
      Accept: "application/json",
      "x-api-key": this.settings.immichApiKey,
    };
  }
}

type MultipartField = {
  name: string;
  value: string;
};

type MultipartFile = {
  fieldName: string;
  filename: string;
  mimeType: string;
  data: ArrayBuffer;
};

type MultipartPayload = {
  fields: MultipartField[];
  file: MultipartFile;
};

function buildMultipartBody(payload: MultipartPayload): { body: Uint8Array; boundary: string } {
  const boundary = `----immich-${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  const push = (value: string | Uint8Array) => {
    chunks.push(typeof value === "string" ? encoder.encode(value) : value);
  };

  for (const field of payload.fields) {
    push(`--${boundary}\r\n`);
    push(`Content-Disposition: form-data; name="${field.name}"\r\n\r\n`);
    push(`${field.value}\r\n`);
  }

  push(`--${boundary}\r\n`);
  push(
    `Content-Disposition: form-data; name="${payload.file.fieldName}"; filename="${payload.file.filename}"\r\n`,
  );
  push(`Content-Type: ${payload.file.mimeType}\r\n\r\n`);
  push(new Uint8Array(payload.file.data));
  push("\r\n");
  push(`--${boundary}--\r\n`);

  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const body = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }

  return { body, boundary };
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

function guessMimeType(extension: string): string {
  const lower = extension.toLowerCase();
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    avif: "image/avif",
    heic: "image/heic",
    heif: "image/heif",
    bmp: "image/bmp",
    tiff: "image/tiff",
    tif: "image/tiff",
  };

  return map[lower] ?? "application/octet-stream";
}

type RequestJsonResponse = {
  status: number;
  json: unknown;
};

type AlbumRecord = {
  id: string;
  albumName: string;
};

type UploadPayload = {
  id: string;
  status: UploadStatus;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAlbumRecord(value: unknown): value is AlbumRecord {
  return isRecord(value) && typeof value.id === "string" && typeof value.albumName === "string";
}

function extractAlbumId(payload: unknown): string | undefined {
  return isAlbumRecord(payload) ? payload.id : undefined;
}

function extractUploadId(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const idCandidates = [
    payload.id,
    payload.assetId,
    payload.duplicateAssetId,
    payload.existingAssetId,
    isRecord(payload.asset) ? payload.asset.id : undefined,
    isRecord(payload.duplicate) ? payload.duplicate.id : undefined,
    isRecord(payload.existing) ? payload.existing.id : undefined,
  ];

  return idCandidates.find((value): value is string => typeof value === "string" && value.length > 0);
}

function parseUploadPayload(payload: unknown): UploadPayload | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const status = payload.status === "duplicate" ? "duplicate" : "created";
  const idCandidates = [
    payload.id,
    payload.assetId,
    payload.duplicateAssetId,
    payload.existingAssetId,
    isRecord(payload.asset) ? payload.asset.id : undefined,
    isRecord(payload.duplicate) ? payload.duplicate.id : undefined,
    isRecord(payload.existing) ? payload.existing.id : undefined,
  ];
  const id = idCandidates.find((value): value is string => typeof value === "string" && value.length > 0);
  if (!id) {
    return undefined;
  }

  return { id, status };
}

function debugLog(message: string, details?: unknown): void {
  if (details === undefined) {
    console.debug(`[Immich] ${message}`);
    return;
  }
  console.debug(`[Immich] ${message}`, details);
}

function warnLog(message: string, details?: unknown): void {
  if (details === undefined) {
    console.warn(`[Immich] ${message}`);
    return;
  }
  console.warn(`[Immich] ${message}`, details);
}

function errorLog(message: string, details?: unknown): void {
  if (details === undefined) {
    console.error(`[Immich] ${message}`);
    return;
  }
  console.error(`[Immich] ${message}`, details);
}
