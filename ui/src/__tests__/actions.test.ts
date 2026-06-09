import { describe, it, expect, vi, beforeEach } from "vitest";
import { approve, mergePR, deploy } from "../pages/actions";

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(ok: boolean, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  } as Response);
}

describe("actions client", () => {
  it("approve posts tier + issue", async () => {
    const f = mockFetch(true, { status: "ok" });
    vi.stubGlobal("fetch", f);
    await approve("pdai", "all", 7);
    expect(f).toHaveBeenCalledWith(
      "/api/projects/pdai/approve",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ tier: "all", issue: 7 }),
      }),
    );
  });

  it("mergePR hits the pull merge path", async () => {
    const f = mockFetch(true, { status: "ok" });
    vi.stubGlobal("fetch", f);
    await mergePR("gnathology", 12);
    expect(f).toHaveBeenCalledWith(
      "/api/projects/gnathology/pulls/12/merge",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("deploy surfaces server error text", async () => {
    const f = mockFetch(false, { error: "compose up failed (exit 2): no space left" });
    vi.stubGlobal("fetch", f);
    await expect(deploy("gnathology")).rejects.toThrow(/no space left/);
  });
});
