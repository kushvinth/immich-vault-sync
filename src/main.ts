import { Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, ImmichSettingTab, type PluginSettings } from "./settings";
import { normalizeImmichUrl, ImmichClient } from "./immich";
import { uploadFolderImages } from "./uploader";

export default class ImmichUploaderPlugin extends Plugin {
  settings: PluginSettings;

  async onload() {
    await this.loadSettings();

    this.addSettingTab(new ImmichSettingTab(this.app, this));

    this.addCommand({
      id: "immich-upload-folder",
        name: "Immich: upload images from configured folder and replace links",
      callback: async () => {
        await uploadFolderImages(this.app, this.settings, this.saveSettings.bind(this));
      },
    });

    this.addCommand({
      id: "immich-test-connection",
        name: "Immich: test connection",
      callback: async () => {
        await this.testConnection();
      },
    });
  }

  async testConnection(): Promise<void> {
    if (!this.settings.immichUrl || !this.settings.immichApiKey) {
      new Notice("Missing Immich url and api key.");
      return;
    }

    const client = new ImmichClient(this.settings);
    await client.testConnection();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<PluginSettings>);
    this.settings.immichUrl = normalizeImmichUrl(this.settings.immichUrl);
    this.settings.uploadedAssets ||= {};
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
