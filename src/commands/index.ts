import type FlyGeneticsPlugin from "../main";
import { activeExcalidrawView, type ExcalidrawViewLike } from "../excalidraw/ea";
import { checkExcalidraw } from "../excalidraw/version";
import { runOperation } from "../operation";
import { breakCross } from "./break-cross";
import { crossGenotypes } from "./cross-genotypes";
import { toggleCrossMode } from "./cross-mode";
import { operationEnv } from "./env";
import { genotype } from "./genotype";
import { select } from "./select";
import { tidy } from "./tidy";
import { tidyBelow } from "./tidy-below";

// Display names are the script names; ids are their kebab-case forms
// (full id "fly-genetics:<id>").
export const COMMANDS = [
  { id: "genotype", name: "Genotype" },
  { id: "cross-genotypes", name: "Cross Genotypes" },
  { id: "cross-mode", name: "Cross Mode" },
  { id: "tidy", name: "Tidy" },
  { id: "tidy-below", name: "Tidy Below" },
  { id: "select-below", name: "Select Below" },
  { id: "select-lineage", name: "Select Lineage" },
  { id: "break-cross", name: "Break Cross" },
] as const;
export type CommandName = (typeof COMMANDS)[number]["name"];
export type CommandId = (typeof COMMANDS)[number]["id"];
export const COMMAND_NAMES: readonly CommandName[] = COMMANDS.map((c) => c.name);
export function commandId(name: CommandName): CommandId {
  const c = COMMANDS.find((x) => x.name === name);
  if (!c) throw new Error(`unknown command ${name}`);
  return c.id;
}
export { operationEnv } from "./env";
export type CommandHandler = (plugin: FlyGeneticsPlugin, view: ExcalidrawViewLike) => Promise<void>;


const HANDLERS: Record<CommandName, CommandHandler> = {
  "Genotype": (plugin, view) => runOperation(plugin.app, operationEnv(plugin), view, "Genotype", (ctx) => genotype(ctx, {}, plugin.testing.modals)).then(() => undefined),
  "Cross Genotypes": (plugin, view) => runOperation(plugin.app, operationEnv(plugin), view, "Cross Genotypes", (ctx) => crossGenotypes(ctx, {}, plugin.testing.modals)).then(() => undefined),
  "Cross Mode": async (plugin, view) => toggleCrossMode(plugin, view),
  "Tidy": (plugin, view) => runOperation(plugin.app, operationEnv(plugin), view, "Tidy", (ctx) => tidy(ctx)).then(() => undefined),
  "Tidy Below": (plugin, view) => runOperation(plugin.app, operationEnv(plugin), view, "Tidy Below", (ctx) => tidyBelow(ctx)).then(() => undefined),
  "Select Below": (plugin, view) => runOperation(plugin.app, operationEnv(plugin), view, "Select Below", (ctx) => select(ctx, "below")).then(() => undefined),
  "Select Lineage": (plugin, view) => runOperation(plugin.app, operationEnv(plugin), view, "Select Lineage", (ctx) => select(ctx, "lineage")).then(() => undefined),
  "Break Cross": (plugin, view) => runOperation(plugin.app, operationEnv(plugin), view, "Break Cross", (ctx) => breakCross(ctx)).then(() => undefined),
};

// Each command is available only with Excalidraw ready and an Excalidraw
// drawing active (as the Script Engine's commands were).
export function registerCommands(plugin: FlyGeneticsPlugin): void {
  for (const { id, name } of COMMANDS) {
    plugin.addCommand({
      id,
      name,
      checkCallback: (checking) => {
        if (!checkExcalidraw(plugin.app).ok) return false;
        const view = activeExcalidrawView(plugin.app);
        if (!view) return false;
        if (!checking) void plugin.testing.run(name, () => HANDLERS[name](plugin, view));
        return true;
      },
    });
  }
}
