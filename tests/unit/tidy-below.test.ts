import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationContext, Started } from "../../src/operation";
import type { SceneElement } from "../../src/schema";

const { notices, selectMock, tidyMock } = vi.hoisted(() => ({
  notices: [] as string[],
  selectMock: vi.fn(),
  tidyMock: vi.fn(),
}));
vi.mock("obsidian", () => ({ Notice: class { constructor(m: string) { notices.push(m); } } }));
vi.mock("../../src/commands/select", () => ({ select: selectMock }));
vi.mock("../../src/commands/tidy", () => ({ tidy: tidyMock }));

import { tidyBelow } from "../../src/commands/tidy-below";

// The hooks live on window; in Node it is globalThis.
const hooks = globalThis as unknown as Record<string, unknown>;
hooks.window ??= globalThis;

const genotypeEl = { id: "a1", customData: { schemaVersion: 2, genotypeId: "gA", kind: "genotype-allele" } } as unknown as SceneElement;
const plainEl = { id: "t1" } as unknown as SceneElement;

interface Call { name: string; body: (c: OperationContext) => Promise<unknown> }
// A context whose start records the command and runs its body against a
// stand-in child context; `results` gives what each started command's
// promise resolves to, `skip` which starts are skipped (stale drawing).
function fakeCtx(selected: SceneElement[], opts: { results?: Record<string, unknown>; skip?: string[] } = {}) {
  const calls: Call[] = [];
  const child = { name: "child" } as unknown as OperationContext;
  const ctx = {
    name: "Tidy Below",
    ea: { getViewSelectedElements: () => selected },
    start(name: string, body: (c: OperationContext) => Promise<unknown>) {
      calls.push({ name, body });
      if (opts.skip?.includes(name)) return Object.assign(Promise.resolve(undefined), { skipped: true as const });
      void body(child);
      return Promise.resolve(opts.results?.[name]) as Started<unknown>;
    },
    join() { throw new Error("tidyBelow must start its commands, not join them"); },
  } as unknown as OperationContext;
  return { ctx, calls, child };
}

const three = { mode: "below", genotypes: 3, genotypeIds: ["gA", "gC", "gD"], elements: 20 };

describe("tidyBelow", () => {
  beforeEach(() => { notices.length = 0; selectMock.mockReset(); tidyMock.mockReset(); });
  afterEach(() => { hooks._tidyBelowFail = undefined; hooks._tidyBelowPause = undefined; hooks._flySelectResult = undefined; });

  it("asks for a genotype and starts nothing without one selected", async () => {
    const { ctx, calls } = fakeCtx([plainEl]);
    await tidyBelow(ctx);
    expect(notices).toEqual(["Tidy Below: select a genotype first."]);
    expect(calls).toEqual([]);
  });

  it("starts Select Below, then Tidy seeded with exactly its genotypes", async () => {
    const { ctx, calls, child } = fakeCtx([plainEl, genotypeEl], { results: { "Select Below": three } });
    await tidyBelow(ctx);
    expect(calls.map((c) => c.name)).toEqual(["Select Below", "Tidy"]);
    expect(selectMock).toHaveBeenCalledWith(child, "below");
    expect(tidyMock).toHaveBeenCalledWith(child, { seed: ["gA", "gC", "gD"] });
    expect(notices).toEqual([]);
  });

  it("clears the result hook Select Below set", async () => {
    // As the real select does on exit.
    selectMock.mockImplementation(() => { hooks._flySelectResult = three; });
    const { ctx } = fakeCtx([genotypeEl], { results: { "Select Below": three } });
    await tidyBelow(ctx);
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(hooks._flySelectResult).toBeUndefined();
  });

  it("says Select Below did not finish when it ended without a result (failed, or skipped)", async () => {
    for (const opts of [{ results: { "Select Below": undefined } }, { results: { "Select Below": null } }, { skip: ["Select Below"] }]) {
      notices.length = 0;
      const { ctx, calls } = fakeCtx([genotypeEl], opts);
      await tidyBelow(ctx);
      expect(notices).toEqual(["Tidy Below: Select Below did not finish."]);
      expect(calls.map((c) => c.name)).toEqual(["Select Below"]);
    }
  });

  it("does not tidy a single genotype (its whole lineage)", async () => {
    const { ctx, calls } = fakeCtx([genotypeEl], { results: { "Select Below": { ...three, genotypes: 1, genotypeIds: ["gA"] } } });
    await tidyBelow(ctx);
    expect(notices).toEqual(["Tidy Below: nothing below this genotype to tidy."]);
    expect(calls.map((c) => c.name)).toEqual(["Select Below"]);
  });

  it("test hook _tidyBelowFail: throws after Select Below, consumed on read", async () => {
    const { ctx, calls } = fakeCtx([genotypeEl], { results: { "Select Below": three } });
    hooks._tidyBelowFail = true;
    await expect(tidyBelow(ctx)).rejects.toThrow("test hook: Tidy Below failed");
    expect(hooks._tidyBelowFail).toBeUndefined();
    expect(calls.map((c) => c.name)).toEqual(["Select Below"]);
  });

  it("test hook _tidyBelowPause: awaited (consumed) before Tidy starts", async () => {
    const { ctx, calls } = fakeCtx([genotypeEl], { results: { "Select Below": three } });
    const seen: string[][] = [];
    hooks._tidyBelowPause = async () => { seen.push(calls.map((c) => c.name)); };
    await tidyBelow(ctx);
    expect(seen).toEqual([["Select Below"]]);
    expect(hooks._tidyBelowPause).toBeUndefined();
    expect(calls.map((c) => c.name)).toEqual(["Select Below", "Tidy"]);
  });

  it("a skipped Tidy (tab switched) is not an error: no notice, nothing thrown", async () => {
    const { ctx, calls } = fakeCtx([genotypeEl], { results: { "Select Below": three }, skip: ["Tidy"] });
    await expect(tidyBelow(ctx)).resolves.toBeUndefined();
    expect(calls.map((c) => c.name)).toEqual(["Select Below", "Tidy"]);
    expect(notices).toEqual([]);
  });
});
