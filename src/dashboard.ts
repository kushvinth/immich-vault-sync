import { App, normalizePath } from "obsidian";
import type { UploadRecord } from "./settings";

/** Per-asset dashboard notes (frontmatter rows for Bases). */
const DASHBOARD_ASSET_FOLDER = "Meta/Media/Asserts-Base-Data";
/** Base lives one level up from the old `Immich Dashboard/` subfolder → `Meta/Shortcuts/Bases/`. */
const DASHBOARD_BASE_FILE = "Meta/Shortcuts/Bases/Immich Assets.base";

export async function updateImmichDashboard(
  app: App,
  assets: Record<string, UploadRecord>,
): Promise<void> {
  await ensureFolderPath(app, "Meta/Shortcuts/Bases");
  await ensureFolderPath(app, DASHBOARD_ASSET_FOLDER);

  for (const [assetPath, record] of Object.entries(assets)) {
    const notePath = `${DASHBOARD_ASSET_FOLDER}/${toSafeName(assetPath)}.md`;
    const sourceExists = app.vault.getAbstractFileByPath(assetPath) !== null;
    const content = buildAssetNoteContent(assetPath, record, sourceExists);
    await app.vault.adapter.write(normalizePath(notePath), content);
  }

  await app.vault.adapter.write(normalizePath(DASHBOARD_BASE_FILE), buildBaseFileContent());
}

async function ensureFolderPath(app: App, folderPath: string): Promise<void> {
  const normalized = normalizePath(folderPath);
  const parts = normalized.split("/").filter(Boolean);
  let current = "";

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (app.vault.getAbstractFileByPath(current)) {
      continue;
    }
    await app.vault.createFolder(current);
  }
}

function toSafeName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}

function buildAssetNoteContent(assetPath: string, record: UploadRecord, sourceExists: boolean): string {
  const now = new Date().toISOString();
  const frontmatter = [
    "---",
    `asset_path: ${quoteYaml(assetPath)}`,
    `asset_id: ${quoteYaml(record.assetId || "")}`,
    `uploaded: ${!!(record.assetId && record.url)}`,
    `status: ${quoteYaml(record.status || "uploaded")}`,
    `url: ${quoteYaml(record.url || "")}`,
    `source_exists: ${sourceExists}`,
    `file_name: ${quoteYaml(record.fileName || "")}`,
    `file_size: ${record.fileSize ?? 0}`,
    `file_mtime: ${record.mtime ?? 0}`,
    `last_attempt_at: ${quoteYaml(record.lastAttemptAt || "")}`,
    `last_uploaded_at: ${quoteYaml(record.lastUploadedAt || "")}`,
    `last_error: ${quoteYaml(record.lastError || "")}`,
    `dashboard_updated_at: ${quoteYaml(now)}`,
    "tags:",
    "  - immich-asset",
    "---",
    "",
  ];

  // Add image preview if URL exists
  if (record.url) {
    frontmatter.push(`![Preview](${record.url})`);
    frontmatter.push("");
  }

  frontmatter.push(`# ${record.fileName || assetPath}`);
  frontmatter.push("");
  frontmatter.push(`- Source path: \`${assetPath}\``,);
  frontmatter.push(`- Uploaded: ${record.assetId && record.url ? "yes" : "no"}`);
  frontmatter.push(record.url ? `- Link: ${record.url}` : "- Link: (none)");
  frontmatter.push("");

  return frontmatter.join("\n");
}

function buildBaseFileContent(): string {
  return [
    "filters:",
    "  and:",
    `    - 'file.inFolder("${DASHBOARD_ASSET_FOLDER}")'`,
    "    - 'file.ext == \"md\"'",
    "formulas:",
    '  health: \'if(uploaded, "ok", "pending")\'',
    "properties:",
    "  file.name:",
    '    displayName: "Asset"',
    "  uploaded:",
    '    displayName: "Uploaded"',
    "  status:",
    '    displayName: "Status"',
    "  url:",
    '    displayName: "Immich URL"',
    "  source_exists:",
    '    displayName: "Exists in Vault"',
    "  last_uploaded_at:",
    '    displayName: "Last Uploaded"',
    "  last_error:",
    '    displayName: "Last Error"',
    "  formula.health:",
    '    displayName: "Health"',
    "views:",
    "  - type: table",
    '    name: "All assets"',
    "    order:",
    "      - file.name",
    "      - uploaded",
    "      - status",
    "      - formula.health",
    "      - source_exists",
    "      - url",
    "      - last_uploaded_at",
    "      - last_error",
    "  - type: cards",
    '    name: "Gallery"',
    "    order:",
    "      - file.name",
    "      - uploaded",
    "      - status",
    "      - url",
  ].join("\n");
}
