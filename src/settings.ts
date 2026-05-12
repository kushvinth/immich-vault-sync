import { App, PluginSettingTab, Setting } from "obsidian";
import type ImmichUploaderPlugin from "./main";

export type LinkStyle = "preview" | "original";
export type ReplaceScope = "vault" | "folder";

export interface UploadRecord {
	assetId: string;
	mtime: number;
	url: string;
	status?: "uploaded" | "duplicate" | "error";
	lastUploadedAt?: string;
	lastAttemptAt?: string;
	lastError?: string;
	fileName?: string;
	fileSize?: number;
}

export interface PluginSettings {
	immichUrl: string;
	immichApiKey: string;
	albumName: string;
	albumId: string;
	albumShareKey: string;
	imageFolder: string;
	includeSubfolders: boolean;
	linkStyle: LinkStyle;
	replaceScope: ReplaceScope;
	uploadedAssets: Record<string, UploadRecord>;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	immichUrl: "",
	immichApiKey: "",
	albumName: "Obsidian Uploads",
	albumId: "",
	albumShareKey: "",
	imageFolder: "Meta/Media",
	includeSubfolders: true,
	linkStyle: "original",
	replaceScope: "vault",
	uploadedAssets: {},
};

export class ImmichSettingTab extends PluginSettingTab {
	plugin: ImmichUploaderPlugin;

	constructor(app: App, plugin: ImmichUploaderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Immich url")
			.setDesc("Use the base url for your Immich instance, with no trailing slash.")
			.addText((text) =>
				text
					.setPlaceholder("https://immich.example.com")
					.setValue(this.plugin.settings.immichUrl)
					.onChange(async (value) => {
						this.plugin.settings.immichUrl = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Immich api key")
			.setDesc("Needs permissions for asset upload and album management.")
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setValue(this.plugin.settings.immichApiKey)
					.onChange(async (value) => {
						this.plugin.settings.immichApiKey = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Album name")
			.setDesc("Uploads are added to this album (created if missing).")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.albumName)
					.onChange(async (value) => {
						this.plugin.settings.albumName = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Album id (optional)")
			.setDesc("If set, the plugin will use this album directly.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.albumId)
					.onChange(async (value) => {
						this.plugin.settings.albumId = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Album share key")
			.setDesc("Required to build public urls after upload.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.albumShareKey)
					.onChange(async (value) => {
						this.plugin.settings.albumShareKey = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Image discovery")
			.setDesc("Configure which vault folder is scanned for image uploads.");

		new Setting(containerEl)
			.setName("Image folder")
			.setDesc("Vault-relative path (for example, meta/media).")
			.addText((text) =>
				text
					.setPlaceholder("For example, meta/media")
					.setValue(this.plugin.settings.imageFolder)
					.onChange(async (value) => {
						this.plugin.settings.imageFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Link style")
			.setDesc("Choose which Immich link format to insert in notes.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("original", "Original file URL")
					.addOption("preview", "Preview thumbnail URL")
					.setValue(this.plugin.settings.linkStyle)
					.onChange(async (value) => {
						this.plugin.settings.linkStyle = value as LinkStyle;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Replace scope")
			.setDesc("Wiki link replacement runs across the full vault.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("vault", "Entire vault")
					.setValue("vault")
					.onChange(async () => {
						this.plugin.settings.replaceScope = "vault" as ReplaceScope;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Test connection")
			.setDesc("Validate the connection to your Immich server.")
			.addButton((button) => {
				button.setButtonText("Test");
				button.onClick(async () => {
					await this.plugin.testConnection();
				});
			});
	}
}
