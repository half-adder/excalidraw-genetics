import { describe, expect, it } from "vitest";
import { compareVersions, excalidrawStatus, EXCALIDRAW_MIN_VERSION } from "../../src/excalidraw/version";

describe("compareVersions", () => {
  it("orders by numeric parts", () => {
    expect(compareVersions("2.20.2", "2.20.2")).toBe(0);
    expect(compareVersions("2.27.3", "2.20.2")).toBe(1);
    expect(compareVersions("2.9.0", "2.20.2")).toBe(-1);
    expect(compareVersions("2.20", "2.20.0")).toBe(0);
    expect(compareVersions("2.20.2-beta-1", "2.20.2")).toBe(0);
  });
});

describe("excalidrawStatus", () => {
  it("accepts the minimum version, enabled", () => {
    expect(excalidrawStatus(EXCALIDRAW_MIN_VERSION, true)).toEqual({ ok: true });
    expect(excalidrawStatus("2.27.3", true)).toEqual({ ok: true });
  });
  it("explains what is missing", () => {
    const missing = excalidrawStatus(null, false);
    const off = excalidrawStatus("2.27.3", false);
    const old = excalidrawStatus("2.19.0", true);
    expect(missing.ok || off.ok || old.ok).toBe(false);
    if (!missing.ok) expect(missing.message).toContain("install");
    if (!off.ok) expect(off.message).toContain("enable");
    if (!old.ok) expect(old.message).toContain("2.19.0");
  });
});
