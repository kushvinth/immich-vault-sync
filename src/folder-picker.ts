import { App, FuzzySuggestModal, TFolder } from "obsidian";

export function pickFolder(app: App, title = "Select a folder"): Promise<TFolder | null> {
  return new Promise((resolve) => {
    const modal = new FolderPickerModal(app, title, resolve);
    modal.open();
  });
}

class FolderPickerModal extends FuzzySuggestModal<TFolder> {
  private picked = false;

  constructor(
    app: App,
    private titleText: string,
    private onPick: (folder: TFolder | null) => void,
  ) {
    super(app);
    this.setPlaceholder(this.titleText);
  }

  getItems(): TFolder[] {
    const root = this.app.vault.getRoot();
    const folders = this.app.vault
      .getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder);

    const byPath = new Map<string, TFolder>();
    byPath.set(root.path, root);
    for (const folder of folders) {
      byPath.set(folder.path, folder);
    }

    return Array.from(byPath.values());
  }

  getItemText(item: TFolder): string {
    return item.path || "/";
  }

  onChooseItem(item: TFolder): void {
    this.picked = true;
    this.onPick(item);
  }

  onClose(): void {
    super.onClose();
    if (!this.picked) {
      this.onPick(null);
    }
  }
}
