import { describe, it, expect } from "vitest";
import { deployRunLabel } from "../pages/projectStatus";

describe("deployRunLabel", () => {
  it("returns empty when never run", () => {
    expect(deployRunLabel(undefined)).toBe("");
    expect(deployRunLabel({})).toBe("");
  });
  it("shows running", () => {
    expect(deployRunLabel({ state: "running" })).toBe("deploy: running…");
  });
  it("shows ok", () => {
    expect(deployRunLabel({ state: "ok" })).toMatch(/^deploy: ok/);
  });
  it("shows failed with error", () => {
    expect(deployRunLabel({ state: "failed", error: "boom" })).toBe("deploy: failed: boom");
  });
});
