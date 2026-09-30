import { describe, expect, it } from "vitest";
import { planFinish, planRollback, raise, recordWrite, sameDrawn, type Saved } from "../../src/operation/pure";
import type { SceneElement } from "../../src/schema";

const el = (id: string, patch: Partial<SceneElement> = {}): SceneElement =>
  ({ id, type: "text", x: 0, y: 0, width: 10, height: 10, version: 1, versionNonce: 1, index: "a0", ...patch });

describe("sameDrawn", () => {
  it("ignores version, versionNonce and updated", () => {
    expect(sameDrawn(el("a"), el("a", { version: 5, versionNonce: 9, updated: 3 }))).toBe(true);
  });
  it("treats absent and deleted alike", () => {
    expect(sameDrawn(undefined, el("a", { isDeleted: true }))).toBe(true);
    expect(sameDrawn(undefined, el("a"))).toBe(false);
  });
  it("sees a moved element and ignores undefined keys", () => {
    expect(sameDrawn(el("a"), el("a", { x: 1 }))).toBe(false);
    expect(sameDrawn(el("a", { link: undefined }), el("a"))).toBe(true);
  });
  it("compares nested values", () => {
    expect(sameDrawn(el("a", { points: [[0, 0], [1, 1]] }), el("a", { points: [[0, 0], [1, 1]] }))).toBe(true);
    expect(sameDrawn(el("a", { points: [[0, 0], [1, 1]] }), el("a", { points: [[0, 0], [1, 2]] }))).toBe(false);
  });
});

describe("raise", () => {
  it("keeps the scene's copy when versions match", () => {
    const cur = el("a", { version: 4 });
    expect(raise(el("a", { version: 4 }), cur, 1)).toBe(cur);
  });
  it("raises past the scene's version", () => {
    expect(raise(el("a", { version: 2 }), el("a", { version: 7 }), 1, () => 42)).toMatchObject({ version: 8, versionNonce: 42 });
  });
  it("raises past its own version when the scene has none", () => {
    expect(raise(el("a", { version: 3 }), undefined, 1, () => 5)).toMatchObject({ version: 4, versionNonce: 5 });
  });
});

describe("planFinish", () => {
  it("records nothing when no element changed", () => {
    expect(planFinish([el("a")], [el("a", { version: 3 })]).changed).toBe(false);
    expect(planFinish(null, [el("a")]).changed).toBe(false);
  });
  it("puts removed elements back as deleted and new ones on top", () => {
    const before = [el("a"), el("b", { index: "a1" })];
    const now = [el("a", { x: 5, version: 2 }), el("c", { index: "a2", version: 1 })];
    const p = planFinish(before, now, () => 7);
    if (!p.changed) throw new Error("expected a change");
    expect(p.first.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(p.first.find((e) => e.id === "b")?.isDeleted).toBe(true);
    expect(p.first.find((e) => e.id === "c")?.index).toBe(null);
    expect(p.second.map((e) => e.id)).toEqual(["a", "b"]);
    const third = p.third(new Map([["c", "a5"]]));
    expect(third.find((e) => e.id === "c")?.index).toBe("a5");
    expect(third.find((e) => e.id === "a")?.x).toBe(5);
  });
  it("raises each step's versions past both copies, and keeps untouched elements as the scene has them", () => {
    const u = el("u", { version: 9 });
    const p = planFinish([el("a", { version: 3 }), u], [el("a", { version: 5, x: 1 }), u], () => 1);
    if (!p.changed) throw new Error("expected a change");
    expect(p.first.map((e) => e.version)).toEqual([6, 9]);
    expect(p.first[1]).toBe(u);
    expect(p.second.map((e) => [e.version, e.x])).toEqual([[7, 0], [9, 0]]);
    expect(p.third(new Map()).map((e) => [e.version, e.x])).toEqual([[8, 1], [9, 0]]);
  });
  it("keeps the old index of a changed element and leaves out elements deleted before the operation", () => {
    const p = planFinish([el("a", { index: "a3" }), el("gone", { isDeleted: true })], [el("a", { index: "a9", version: 2 })], () => 1);
    if (!p.changed) throw new Error("expected a change");
    expect(p.first.map((e) => [e.id, e.index])).toEqual([["a", "a3"]]);
  });
});

describe("recordWrite", () => {
  it("keeps each element's first state and its last written version", () => {
    const saved = new Map<string, Saved>();
    recordWrite(saved, [el("a"), el("b")], [el("a", { version: 2, x: 1 }), el("b"), el("n", { version: 1 })]);
    recordWrite(saved, [el("a", { version: 2, x: 1 }), el("b"), el("n")], [el("a", { version: 3, x: 2 }), el("n")]);
    expect(saved.get("a")).toEqual({ was: el("a"), last: 3 });
    expect(saved.get("n")).toEqual({ was: null, last: 1 });
    expect(saved.get("b")).toEqual({ was: el("b"), last: undefined });
    expect(saved.has("c")).toBe(false);
  });
});

describe("planRollback", () => {
  const nonce = () => 11;
  it("puts back what the script changed and removes what it added", () => {
    const saved = new Map<string, Saved>([["a", { was: el("a"), last: 2 }], ["n", { was: null, last: 1 }]]);
    const now = [el("a", { x: 5, version: 2 }), el("n", { version: 1 }), el("o", { version: 4 })];
    const back = planRollback(now, saved, nonce);
    expect(back.map((e) => [e.id, e.x, e.version])).toEqual([["a", 0, 3], ["o", 0, 4]]);
  });
  it("leaves an element changed since by someone else", () => {
    const saved = new Map<string, Saved>([["a", { was: el("a"), last: 2 }], ["n", { was: null, last: 1 }]]);
    const now = [el("a", { x: 7, version: 3 }), el("n", { version: 2 })];
    const back = planRollback(now, saved, nonce);
    expect(back.map((e) => [e.id, e.x, e.version])).toEqual([["a", 7, 3], ["n", 0, 2]]);
  });
  it("puts back an element the script removed from the scene", () => {
    const saved = new Map<string, Saved>([["b", { was: el("b", { version: 4 }), last: undefined }]]);
    const back = planRollback([el("o")], saved, nonce);
    expect(back.map((e) => [e.id, e.version])).toEqual([["o", 1], ["b", 5]]);
  });
});
