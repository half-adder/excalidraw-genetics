import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dateVersion, setVersion } from "../../tools/set-version.mjs";

describe("dateVersion", () => {
  it("is YYYY.MDD.N, counting releases the same day", () => {
    expect(dateVersion(new Date(2026, 8, 29), [])).toBe("2026.929.0");
    expect(dateVersion(new Date(2026, 8, 29), ["2026.929.0"])).toBe("2026.929.1");
    expect(dateVersion(new Date(2026, 9, 1), ["2026.929.0", "2026.929.1"])).toBe("2026.1001.0");
    expect(dateVersion(new Date(2026, 11, 5), ["2026.1205.0", "2026.1205.3"])).toBe("2026.1205.4");
  });
});

describe("setVersion", () => {
  const root = () => {
    const d = mkdtempSync(join(tmpdir(), "fly-version-"));
    writeFileSync(join(d, "manifest.json"), JSON.stringify({ id: "fly-genetics", version: "2026.929.0", minAppVersion: "1.5.0" }));
    writeFileSync(join(d, "package.json"), JSON.stringify({ name: "fly-genetics", version: "2026.929.0" }));
    writeFileSync(join(d, "versions.json"), JSON.stringify({ "2026.929.0": "1.5.0" }));
    return d;
  };
  it("writes the version everywhere", () => {
    const d = root();
    setVersion(d, "2026.1001.0");
    expect(JSON.parse(readFileSync(join(d, "manifest.json"), "utf8")).version).toBe("2026.1001.0");
    expect(JSON.parse(readFileSync(join(d, "package.json"), "utf8")).version).toBe("2026.1001.0");
    expect(JSON.parse(readFileSync(join(d, "versions.json"), "utf8"))).toEqual({ "2026.929.0": "1.5.0", "2026.1001.0": "1.5.0" });
  });
  it("refuses a version that is not YYYY.MDD.N", () => {
    for (const v of ["2026.9.29", "2026.929", "2026.1332.0", "2026.1300.0", "2026.929.0.1", "1.2.3"]) expect(() => setVersion(root(), v)).toThrow();
  });
});
