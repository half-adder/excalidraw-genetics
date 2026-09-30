import type FlyGeneticsPlugin from "../main";
import { newEA } from "../excalidraw/ea";
import type { OperationEnv } from "../operation";

// What the operation needs from the plugin: a fresh EA per command, where a
// failed command is reported, and in-flight tracking of the commands an
// operation starts (the tests wait for them).
export function operationEnv(plugin: FlyGeneticsPlugin): OperationEnv {
  return {
    newEA,
    reportError: (name, error) => plugin.testing.record(name, error),
    track: (name, work) => plugin.testing.run(name, work),
  };
}
