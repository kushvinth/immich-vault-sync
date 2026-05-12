# Immich Vault Sync

Sync selected image folders from Obsidian to Immich, then replace wiki links with Immich asset links so notes keep pointing at the uploaded media.

## Features

- Uploads images from a configured vault folder to Immich.
- Reuses an existing album or creates one automatically.
- Replaces matching `[[wiki links]]` with Immich URLs after upload.
- Stores upload metadata in a local cache so repeated runs can skip unchanged files.
- Builds a simple asset dashboard inside the vault.

## Requirements

- Obsidian 0.15.0 or newer.
- An Immich instance with an API key that can upload assets and manage albums.

## Installation

### From a release

1. Download the release artifacts for the version you want.
2. Copy `main.js`, `manifest.json`, and `styles.css` into `<Vault>/.obsidian/plugins/immich-photo-sync/`.
3. Reload Obsidian and enable the plugin in **Settings → Community plugins**.

### From source

1. Clone this repository.
2. Run `npm install`.
3. Run `npm run dev` for a watch build or `npm run build` for a production build.
4. Copy the generated release files into your vault plugin folder.

## Setup

1. Open the plugin settings.
2. Set your Immich URL and API key.
3. Choose the vault folder that contains the images you want to sync.
4. Configure the album name or album ID and the share key used for public links.

## Usage

- Run **Immich: Upload images from configured folder and replace links** to upload the configured image folder.
- Run **Immich: Test connection** to confirm the Immich server and API key are working.

## Privacy

- The plugin runs locally inside Obsidian.
- It only sends data to the Immich server you configure.
- No telemetry is collected.

