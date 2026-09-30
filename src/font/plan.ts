export const FONT_NAME = "cmu-serif-500-roman.ttf";
export const LICENSE_NAME = "CMU-OFL.txt";
export const DEFAULT_FONT_FOLDER = "Excalidraw/Fonts";

export interface FontState { fontSize: number | null; expectedSize: number; enabled: boolean; currentFont: string | null; fontPath: string }
export interface FontPlan { writeFont: boolean; settings: "ours" | "set" | "ask-replace" }

// The scripts installer's rules (installer/installer.template.md, sections
// "2. Font" and "3. Excalidraw local font setting"): write the font if it is
// absent or its size differs; leave Excalidraw's local font alone if it is
// already ours, ask before replacing another local font, otherwise point it
// at ours.
export function planFontSetup(st: FontState): FontPlan {
  const writeFont = st.fontSize === null || st.fontSize !== st.expectedSize;
  const alreadyOurs = st.enabled && st.currentFont === st.fontPath;
  const otherFont = st.enabled && !alreadyOurs;
  return { writeFont, settings: alreadyOurs ? "ours" : otherFont ? "ask-replace" : "set" };
}

export const needsFontSetup = (p: FontPlan): boolean => p.writeFont || p.settings !== "ours";

export interface FontActions { writeFont: boolean; writeLicense: boolean; setLocalFont: boolean; note: string }

// What an answered offer does. Declined: nothing. Confirmed: as the
// installer, the font only when the plan says so, the license always, and
// the local font per the plan (`replaceOther` is the answer to the
// installer's second question, used only for "ask-replace").
export function fontActions(plan: FontPlan, confirmed: boolean, opts: { skipSettings: boolean; replaceOther: boolean }): FontActions {
  if (!confirmed) return { writeFont: false, writeLicense: false, setLocalFont: false, note: "" };
  const base = { writeFont: plan.writeFont, writeLicense: true };
  if (opts.skipSettings) return { ...base, setLocalFont: false, note: "" };
  if (plan.settings === "ours") return { ...base, setLocalFont: false, note: "Local font was already set to Computer Modern." };
  if (plan.settings === "ask-replace" && !opts.replaceOther) return { ...base, setLocalFont: false, note: "Kept your local font; genotypes will be drawn in it." };
  return { ...base, setLocalFont: true, note: "Local font set to Computer Modern. Reopen open drawings to see it." };
}

// Excalidraw's local-font settings, spelled as Excalidraw spells them.
export interface ExcalidrawFontSettings { experimentalEnableFourthFont?: boolean; experimantalFourthFont?: string }
