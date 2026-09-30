import { Modal, Notice, Setting, normalizePath, type App } from "obsidian";
import type FlyGeneticsPlugin from "../main";
import { put, take } from "../hooks";
import { EXCALIDRAW_ID } from "../excalidraw/version";
import type { AppInternals } from "../excalidraw/ea";
import { FONT_BYTES, LICENSE_TEXT } from "./assets";
import { DEFAULT_FONT_FOLDER, FONT_NAME, LICENSE_NAME, fontActions, needsFontSetup, planFontSetup, type ExcalidrawFontSettings } from "./plan";

interface ExcalidrawLike {
  settings?: ExcalidrawFontSettings;
  saveSettings?(): Promise<void>;
  initializeFonts?(): Promise<void>;
}

const TITLE = "Set up the Computer Modern font";

// A yes/no question with two buttons (the installer used utils.suggester).
// Closing it without a button (Esc, the X, the harness's closeModals)
// answers no.
class AskModal extends Modal {
  private answered = false;
  constructor(
    app: App,
    private readonly text: string,
    private readonly no: string,
    private readonly yes: string,
    private readonly modals: Set<Modal>,
    private readonly resolve: (yes: boolean) => void,
  ) { super(app); }

  onOpen(): void {
    this.titleEl.setText(TITLE);
    this.contentEl.createEl("p", { text: this.text });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText(this.no).onClick(() => this.answer(false)))
      .addButton((b) => b.setButtonText(this.yes).setCta().onClick(() => this.answer(true)));
  }
  private answer(yes: boolean): void { this.answered = true; this.resolve(yes); this.close(); }
  onClose(): void { this.contentEl.empty(); this.modals.delete(this); if (!this.answered) this.resolve(false); }
}

function ask(plugin: FlyGeneticsPlugin, text: string, no: string, yes: string): Promise<boolean> {
  return new Promise((resolve) => {
    const m = new AskModal(plugin.app, text, no, yes, plugin.testing.modals, resolve);
    plugin.testing.modals.add(m);
    m.open();
  });
}

async function ensureFolder(app: App, path: string): Promise<void> {
  let cur = "";
  for (const part of path.split("/")) {
    cur = cur ? `${cur}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(cur)) await app.vault.createFolder(cur);
  }
}

type FileLike = { stat?: { size: number } };

// First load: if the Computer Modern font or Excalidraw's local-font setting
// is missing, offers to set it up exactly as the scripts installer did (same
// files, same rules, same questions). Never without confirmation; asks once
// (the answer is saved).
export async function offerFontSetup(plugin: FlyGeneticsPlugin): Promise<void> {
  // Both hooks must be set together in this same call (see src/hooks.ts): a
  // leftover _flyFontAuto on its own is cleared and ignored.
  const hook = take("_flyFontAuto");
  const auto = take("_flyFontTestMode") ? hook : undefined;
  if (auto) {
    if (!auto.fontFolder) throw new Error("font setup test mode needs a fontFolder");
    if (!auto.skipSettings && !auto.settings) throw new Error("font setup test mode needs skipSettings or injected settings");
  }
  if (!auto && plugin.settings.font !== "pending") return;
  const { app } = plugin;
  const excalidraw = (app as AppInternals).plugins.plugins[EXCALIDRAW_ID] as unknown as ExcalidrawLike | undefined;
  // No Excalidraw settings object to change (not auto): the files are still
  // offered, the local-font step is skipped (never set on a throwaway {}).
  const target: ExcalidrawFontSettings | undefined = auto ? auto.settings : excalidraw?.settings;
  const skipSettings = auto?.skipSettings ?? !target;
  const xsettings: ExcalidrawFontSettings = target ?? {};
  // Saves the answer; in test mode it is kept in memory only, never written
  // to the plugin's data.json.
  const save = async (font: "done" | "declined"): Promise<void> => {
    plugin.settings.font = font;
    if (!auto) await plugin.saveSettings();
  };

  const fontFolder = normalizePath((auto?.fontFolder ?? DEFAULT_FONT_FOLDER).replace(/\/+$/, ""));
  const fontPath = `${fontFolder}/${FONT_NAME}`;
  const fontFile = app.vault.getAbstractFileByPath(fontPath) as FileLike | null;
  const plan = planFontSetup({
    fontSize: fontFile?.stat ? fontFile.stat.size : null,
    expectedSize: FONT_BYTES.byteLength,
    enabled: skipSettings ? true : !!xsettings.experimentalEnableFourthFont,
    currentFont: skipSettings ? fontPath : (xsettings.experimantalFourthFont ?? null),
    fontPath,
  });

  if (!needsFontSetup(plan)) {
    await save("done");
    put("_flyFontResult", { fontPath, wroteFont: false, note: "", declined: false });
    return;
  }

  const confirmed = auto?.confirm ?? await ask(plugin,
    `Fly Genetics draws genotypes in Computer Modern, like LaTeX. Write the font (SIL Open Font License) to ${fontFolder} and use it as Excalidraw's local font?`,
    "Not now", "Set up");
  // Closed by the plugin unloading: not an answer, nothing is saved.
  if (plugin.unloaded) return;
  if (!confirmed) {
    await save("declined");
    put("_flyFontResult", { fontPath, wroteFont: false, note: "", declined: true });
    return;
  }

  // As the installer: files first, then the local-font setting.
  const files = fontActions(plan, confirmed, { skipSettings: true, replaceOther: false });
  await ensureFolder(app, fontFolder);
  if (files.writeFont) {
    const buffer = FONT_BYTES.buffer.slice(FONT_BYTES.byteOffset, FONT_BYTES.byteOffset + FONT_BYTES.byteLength) as ArrayBuffer;
    const f = app.vault.getAbstractFileByPath(fontPath);
    if (f) await app.vault.modifyBinary(f as never, buffer);
    else await app.vault.createBinary(fontPath, buffer);
  }
  const licensePath = `${fontFolder}/${LICENSE_NAME}`;
  const lic = app.vault.getAbstractFileByPath(licensePath);
  if (files.writeLicense) {
    if (lic) await app.vault.modify(lic as never, LICENSE_TEXT);
    else await app.vault.create(licensePath, LICENSE_TEXT);
  }

  const replaceOther = !skipSettings && plan.settings === "ask-replace"
    ? auto?.replaceOther ?? await ask(plugin,
      `Excalidraw's local font is set to "${xsettings.experimantalFourthFont}". Replace it with Computer Modern?`,
      "Keep my font", "Use Computer Modern")
    : false;
  // Unloaded during the second question: the files are written, but the
  // local font is left alone and the offer stays pending.
  if (plugin.unloaded) return;
  const actions = fontActions(plan, confirmed, { skipSettings, replaceOther });
  if (actions.setLocalFont) {
    xsettings.experimentalEnableFourthFont = true;
    xsettings.experimantalFourthFont = fontPath;
    if (auto) {
      await auto.saveExcalidraw?.();
    } else {
      await excalidraw?.saveSettings?.();
      await excalidraw?.initializeFonts?.();
    }
  }

  await save("done");
  if (actions.note) new Notice(actions.note);
  put("_flyFontResult", { fontPath, wroteFont: files.writeFont, note: actions.note, declined: false });
}
