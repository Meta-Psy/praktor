import { describe, it, expect } from "vitest";
import { buildAgentSettings, HOOK_SCRIPT_PATH } from "../safety-hooks.js";

describe("buildAgentSettings", () => {
  it("регистрирует PreToolUse command-хук на safety-guard для Bash/Edit/Write/NotebookEdit", () => {
    const s = buildAgentSettings();
    const pre = s.hooks.PreToolUse;
    expect(pre).toHaveLength(1);
    expect(pre[0].matcher).toBe("Bash|Edit|Write|NotebookEdit");
    expect(pre[0].hooks[0]).toMatchObject({
      type: "command",
      command: `node ${HOOK_SCRIPT_PATH}`,
    });
    expect(pre[0].hooks[0].timeout).toBeGreaterThan(0);
  });

  it("указывает на non-volume путь образа (/opt), не на /home/praktor", () => {
    expect(HOOK_SCRIPT_PATH).toBe("/opt/praktor-hooks/safety-guard.cjs");
  });
});
