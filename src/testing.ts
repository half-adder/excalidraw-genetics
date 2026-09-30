import type { Modal } from "obsidian";
import type { ExcalidrawViewLike } from "./excalidraw/ea";
import { openOperation } from "./operation";

// State the Obsidian-driven tests read through app.plugins.plugins["fly-genetics"].testing:
// commands in flight (so a test waits for a command and everything it runs),
// errors thrown by commands, modals the plugin has open (closed when a test
// ends), and the plugin's own operation registry (the scripts keep theirs in
// window._flyOperations).
export class TestingHooks {
  inflight = 0;
  readonly errors: string[] = [];
  readonly modals = new Set<Modal>();

  // The view's open operation, undefined if none.
  openOperation(view: ExcalidrawViewLike): unknown {
    return openOperation(view);
  }

  async run(name: string, work: () => Promise<unknown>): Promise<void> {
    this.inflight++;
    try {
      await work();
    } catch (e) {
      this.record(name, e);
    } finally {
      this.inflight--;
    }
  }

  record(name: string, error: unknown): void {
    this.errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`Fly Genetics: ${name}:`, error);
  }

  // Resolves once no command has been running for 30 ms.
  async idle(ms = 20000): Promise<void> {
    const t0 = Date.now();
    let calm = 0;
    while (Date.now() - t0 < ms) {
      calm = this.inflight === 0 ? calm + 1 : 0;
      if (calm >= 3) return;
      await new Promise((r) => window.setTimeout(r, 10));
    }
    throw new Error(`commands still running after ${ms} ms`);
  }

  closeModals(): void {
    for (const m of [...this.modals]) m.close();
    this.modals.clear();
  }
}
