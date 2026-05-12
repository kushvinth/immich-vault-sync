import { App, TFile } from "obsidian";

const WIKI_LINK_REGEX = /(!)?\[\[([^\]]+)\]\]/g;

export type LinkReplaceResult = {
  filesUpdated: number;
  linksReplaced: number;
};

export async function replaceWikiLinks(
  app: App,
  assetUrls: Map<string, string>,
  scopeFolder?: string,
  excludeFolderPrefix?: string,
): Promise<LinkReplaceResult> {
  const markdownFiles = app.vault.getMarkdownFiles().filter((file: TFile) => {
    if (excludeFolderPrefix && file.path.startsWith(excludeFolderPrefix)) {
      return false;
    }
    if (!scopeFolder) {
      return true;
    }
    return file.path === scopeFolder || file.path.startsWith(`${scopeFolder}/`);
  });

  const assetPaths = new Set(assetUrls.keys());
  let filesUpdated = 0;
  let linksReplaced = 0;

  for (const file of markdownFiles) {
    const original = await app.vault.read(file);
    let changed = false;

    const updated = original.replace(
      WIKI_LINK_REGEX,
      (match: string, embedFlag: string | undefined, inner: string) => {
      const { linkPath, alias } = splitLink(inner);
      if (!linkPath) {
        return match;
      }

      const resolved = app.metadataCache.getFirstLinkpathDest(linkPath, file.path);
      if (!resolved || !(resolved instanceof TFile)) {
        return match;
      }

      if (!assetPaths.has(resolved.path)) {
        return match;
      }

      const url = assetUrls.get(resolved.path);
      if (!url) {
        return match;
      }

      const text = escapeMarkdownText(alias || resolved.basename);
      const wrappedUrl = `<${url}>`;
      const replacement = embedFlag ? `![${text}](${wrappedUrl})` : `[${text}](${wrappedUrl})`;

      linksReplaced += 1;
      changed = true;
        return replacement;
      },
    );

    if (changed) {
      filesUpdated += 1;
      await app.vault.modify(file, updated);
    }
  }

  return { filesUpdated, linksReplaced };
}

function splitLink(value: string): { linkPath: string; alias: string } {
  const pipeIndex = value.indexOf("|");
  const rawTarget = pipeIndex === -1 ? value : value.slice(0, pipeIndex);
  const alias = pipeIndex === -1 ? "" : value.slice(pipeIndex + 1).trim();
  const hashIndex = rawTarget.indexOf("#");
  const linkPath = (hashIndex === -1 ? rawTarget : rawTarget.slice(0, hashIndex)).trim();
  return { linkPath, alias };
}

function escapeMarkdownText(value: string): string {
  return value.replace(/\]/g, "\\]");
}
