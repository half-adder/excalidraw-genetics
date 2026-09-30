// Pure parts of the undo-safe transaction (src/operation/index.ts), ported
// from the "Undo-safe operations" block of the scripts (flyRaise, flySame,
// flyFinish, and the bookkeeping of flyWriting and flyOperation's rollback).
// Design: docs/plans/2026-09-29-undo-safe-design.md.

import type { SceneElement } from "../schema";

export type Nonce = () => number;
const randomNonce: Nonce = () => Math.floor(Math.random() * 2 ** 31);

// `el` with its version raised past `current` (the scene's copy) by `by`, so
// Excalidraw's store sees it; unchanged if it is the scene's version.
export function raise(el: SceneElement, current: SceneElement | null | undefined, by: number, nonce: Nonce = randomNonce): SceneElement {
  if (current && current.version === el.version) return current;
  return { ...el, version: Math.max(el.version ?? 0, current?.version ?? 0) + by, versionNonce: nonce() };
}

const SKIP = new Set(["version", "versionNonce", "updated"]);
const deepSame = (x: unknown, y: unknown): boolean => {
  if (x === y) return true;
  if (!x || !y || typeof x !== "object" || typeof y !== "object" || Array.isArray(x) !== Array.isArray(y)) return false;
  const a = x as Record<string, unknown>, b = y as Record<string, unknown>;
  const kx = Object.keys(a).filter((k) => a[k] !== undefined && !SKIP.has(k));
  const ky = Object.keys(b).filter((k) => b[k] !== undefined && !SKIP.has(k));
  return kx.length === ky.length && kx.every((k) => deepSame(a[k], b[k]));
};

// Whether two copies of an element draw the same (both absent or deleted,
// or equal but for version, versionNonce and updated).
export function sameDrawn(a: SceneElement | undefined, b: SceneElement | undefined): boolean {
  const drawn = (e: SceneElement | undefined) => !!e && !e.isDeleted;
  if (!drawn(a) || !drawn(b)) return drawn(a) === drawn(b);
  return deepSame(a, b);
}

export type FinishPlan =
  | { changed: false }
  | {
      changed: true;
      // (1) the final scene with the new elements' index cleared, NEVER
      first: SceneElement[];
      // (2) "before" (the old elements as they were), NEVER, old selection
      second: SceneElement[];
      // (3) "after", IMMEDIATELY: the old elements as they are now (old index,
      // removed ones back as deleted), then the new ones at the indices
      // Excalidraw gave them in (1)
      third(index: ReadonlyMap<string, string | null | undefined>): SceneElement[];
    };

// How flyFinish records an operation: nothing if no element changed since
// `before` (the scene at its first change; null: it changed nothing),
// otherwise three scene updates. Recorded as the change from "before" (the
// old elements as they were) to "after" (the old elements as they are now,
// in their order and with their fractional index, those the operation
// removed back in place as deleted; then the new elements on top). First the
// new elements get their indices from Excalidraw, so its store holds them at
// those indices when "before" leaves them out: undo and redo then move
// nothing in the z-order. Each scene update raises the versions of what it
// changes, so the store sees it (an element left out is marked deleted one
// version up).
export function planFinish(before: readonly SceneElement[] | null, now: readonly SceneElement[], nonce: Nonce = randomNonce): FinishPlan {
  const was = new Map((before ?? []).map((el) => [el.id, el]));
  const is = new Map(now.map((el) => [el.id, el]));
  const changed = !!before && [...new Set([...was.keys(), ...is.keys()])].some((id) => !sameDrawn(was.get(id), is.get(id)));
  if (!before || !changed) return { changed: false };
  const base = (id: string) => Math.max(was.get(id)?.version ?? 0, is.get(id)?.version ?? 0);
  const untouched = (id: string) => was.get(id)?.version === is.get(id)?.version && was.get(id)?.index === is.get(id)?.index;
  const at = (el: SceneElement, step: number, patch: Partial<SceneElement> = {}): SceneElement =>
    untouched(el.id) ? (is.get(el.id) as SceneElement) : { ...el, ...patch, version: base(el.id) + step, versionNonce: nonce() };
  const kept = before.filter((el) => is.has(el.id) || !el.isDeleted);
  const added = now.filter((el) => !was.has(el.id));
  const final = (el: SceneElement): SceneElement => {
    const cur = is.get(el.id);
    return cur ? { ...cur, index: el.index } : { ...el, isDeleted: true };
  };
  return {
    changed: true,
    first: [...kept.map((el) => at(final(el), 1)), ...added.map((el) => at(el, 1, { index: null }))],
    second: kept.map((el) => at(el, 2)),
    third: (index) => [...kept.map((el) => at(final(el), 3)), ...added.map((el) => at(el, 3, { index: index.get(el.id) }))],
  };
}

// What one script's writes changed: for every element a write of its own
// changed, added or removed, how it was before the script's first change to
// it (`was`, null: it did not exist) and the version its last write left
// (`last`, undefined: that write removed it from the scene).
export interface Saved {
  was: SceneElement | null;
  last?: number;
}

// Notes in `saved` what a write changed, from the scene before it (`pre`, a
// copy) to the scene after it (`now`).
export function recordWrite(saved: Map<string, Saved>, pre: readonly SceneElement[], now: readonly SceneElement[]): void {
  const was = new Map(pre.map((el) => [el.id, el]));
  const keep = (id: string, el: SceneElement | undefined, last: number | undefined) => {
    let s = saved.get(id);
    if (!s) saved.set(id, (s = { was: el ?? null }));
    s.last = last;
  };
  for (const el of now) if (was.get(el.id)?.version !== el.version) keep(el.id, was.get(el.id), el.version);
  const ids = new Set(now.map((el) => el.id));
  for (const [id, el] of was) if (!ids.has(id)) keep(id, el, undefined);
}

// The scene with what a failing script changed put back as it was before its
// first change to it (elements it added removed). An element whose version
// is no longer the one the script's last write left was changed since by
// someone else and is left as it is.
export function planRollback(now: readonly SceneElement[], saved: ReadonlyMap<string, Saved>, nonce: Nonce = randomNonce): SceneElement[] {
  const byId = new Map(now.map((el) => [el.id, el]));
  const mine = (id: string) => saved.has(id) && byId.get(id)?.version === saved.get(id)?.last;
  const back = now
    .filter((el) => !mine(el.id) || saved.get(el.id)?.was)
    .map((el) => {
      const was = mine(el.id) ? saved.get(el.id)?.was : null;
      return was ? raise(was, el, 1, nonce) : el;
    });
  for (const [id, s] of saved) if (s.was && !byId.has(id) && s.last === undefined) back.push(raise(s.was, null, 1, nonce));
  return back;
}
