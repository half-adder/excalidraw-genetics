import { Notice, Plugin } from "obsidian";
import { registerCommands } from "./commands";
import { checkExcalidraw } from "./excalidraw/version";
import { peek } from "./hooks";
import { runFirstLoadOffers } from "./first-load";
import { offerFontSetup } from "./font";
import { offerMigration } from "./migration";
import { DEFAULT_SETTINGS, type FlyGeneticsSettings } from "./settings";
import { TestingHooks } from "./testing";

export default class FlyGeneticsPlugin extends Plugin {
  readonly testing = new TestingHooks();
  settings: FlyGeneticsSettings = DEFAULT_SETTINGS;
  // Set on unload, before the open prompts are closed: a prompt closed by
  // the unload is not an answer, so nothing is saved or started after it.
  unloaded = false;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<FlyGeneticsSettings> | null);
    registerCommands(this);
    this.app.workspace.onLayoutReady(() => {
      // Unloaded before the layout was ready: offer nothing.
      if (this.unloaded) return;
      const check = checkExcalidraw(this.app);
      if (!check.ok) { new Notice(check.message, 0); return; }
      void runFirstLoadOffers({
        font: () => this.offerFontSetup(),
        migration: () => this.offerMigration(),
        record: (name, e) => this.testing.record(name, e),
        unloaded: () => this.unloaded,
      });
    });
  }

  onunload(): void {
    this.unloaded = true;
    // A failing stop must not keep the open prompts from being closed.
    try {
      peek("_flyCrossMode")?.stop();
    } catch (e) {
      this.testing.record("Cross Mode", e);
    }
    this.testing.closeModals();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  offerFontSetup(): Promise<void> {
    return offerFontSetup(this);
  }

  // `folder` overrides the Excalidraw script-folder lookup (tests use it to
  // point at a throwaway folder without touching Excalidraw's settings).
  offerMigration(folder?: string): Promise<void> {
    return offerMigration(this, folder);
  }
}
