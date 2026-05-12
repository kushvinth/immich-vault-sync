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
    console.log("[Immich] Testing connection", { url: aboutUrl });
    try {
      const result = await requestUrl({
        url: aboutUrl,
        headers: this.authHeaders(),
      });

      console.log("[Immich] Connection response", { status: result.status });
      if (result.status === 200) {
        new Notice("Immich connection successful");
        return;
      }
    } catch (error) {
      console.error("[Immich] Connection failed", error);
    }

    new Notice("Failed to connect to Immich. Check the console for details.");
  }

  async ensureAlbum(): Promise<string> {
    if (this.settings.albumId) {
      console.log("[Immich] Using configured album ID", { albumId: this.settings.albumId });
      const existing = await this.getAlbumById(this.settings.albumId);
      if (existing) {
        console.log("[Immich] Album found", { albumId: existing.id, albumName: existing.albumName });
        return existing.id;
      }
      console.warn("[Immich] Album ID not found, falling back to name lookup", {
        albumId: this.settings.albumId,
      });
    }

    console.log("[Immich] Looking up album by name", { albumName: this.settings.albumName });
    const byName = await this.findAlbumByName(this.settings.albumName);
    if (byName) {
      console.log("[Immich] Album found", { albumId: byName.id, albumName: byName.albumName });
      return byName.id;
    }

    console.log("[Immich] Creating album", { albumName: this.settings.albumName });
    const created = await this.createAlbum(this.settings.albumName);
    console.log("[Immich] Album created", { albumId: created.id, albumName: created.albumName });
    return created.id;
  }

  async uploadAsset(file: TFile, data: ArrayBuffer): Promise<UploadResult> {
    const createdAt = new Date(file.stat.ctime).toISOString();
    const modifiedAt = new Date(file.stat.mtime).toISOString();
    const deviceAssetId = `${file.path}-${file.stat.mtime}`;

    console.log("[Immich] Uploading asset", {
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
      result = await requestUrl({
        url: `${this.baseUrl}/api/assets`,
        method: "POST",
        headers: {
          ...this.authHeaders(),
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body: toArrayBuffer(body),
      });
    } catch (error) {
      console.error("[Immich] Upload request failed", {
        path: file.path,
        deviceAssetId,
        error,
      });
      throw error;
    }

    console.log("[Immich] Upload response", { status: result.status, assetId: result.json?.id });

    const payload = parseUploadPayload(result.json);
    if (!payload?.id) {
      throw new Error(`Unexpected upload response (${result.status})`);
    }

    return payload;
  }

  async addAssetToAlbum(albumId: string, assetId: string): Promise<void> {
    console.log("[Immich] Adding asset to album", { albumId, assetId });
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
    console.log("[Immich] Fetching album list", { isOwned: true });
    const result = await requestUrl({
      url: `${this.baseUrl}/api/albums?isOwned=true`,
      headers: this.authHeaders(),
    });

    if (!Array.isArray(result.json)) {
      return null;
    }

    const match = result.json.find((album) => album.albumName === name);
    return match ? { id: match.id, albumName: match.albumName } : null;
  }

  private async getAlbumById(id: string): Promise<{ id: string; albumName: string } | null> {
    try {
      console.log("[Immich] Fetching album by ID", { albumId: id });
      const result = await requestUrl({
        url: `${this.baseUrl}/api/albums/${id}`,
        headers: this.authHeaders(),
      });

      if (result.status !== 200) {
        return null;
      }

      return { id: result.json?.id, albumName: result.json?.albumName };
    } catch {
      return null;
    }
  }

  private async createAlbum(name: string): Promise<{ id: string; albumName: string }>
  {
    const result = await requestUrl({
      url: `${this.baseUrl}/api/albums`,
      method: "POST",
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ albumName: name }),
    });

    console.log("[Immich] Create album response", { status: result.status, albumId: result.json?.id });

    if (!result.json?.id) {
      throw new Error("Failed to create Immich album");
    }

    return { id: result.json.id, albumName: result.json.albumName };
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

function parseUploadPayload(payload: unknown): UploadResult | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const data = payload as Record<string, unknown>;
  const status = (data.status === "duplicate" ? "duplicate" : "created") as UploadStatus;
  const idCandidates = [
    data.id,
    data.assetId,
    data.duplicateAssetId,
    data.existingAssetId,
    (data.asset as Record<string, unknown> | undefined)?.id,
    (data.duplicate as Record<string, unknown> | undefined)?.id,
    (data.existing as Record<string, unknown> | undefined)?.id,
  ];
  const id = idCandidates.find((value): value is string => typeof value === "string" && value.length > 0);
  if (!id) {
    return undefined;
  }

  return { id, status };
}
