import { mkdirSync, writeFileSync } from "fs";

// Скрипт запечён в образ агента (non-volume путь — /home/praktor затеняется
// named-томом praktor-home-<ws>, потому НЕ туда).
export const HOOK_SCRIPT_PATH = "/opt/praktor-hooks/safety-guard.cjs";

const CLAUDE_DIR = "/home/praktor/.claude";
const SETTINGS_PATH = `${CLAUDE_DIR}/settings.json`;

export interface AgentSettings {
  hooks: {
    PreToolUse: Array<{
      matcher: string;
      hooks: Array<{ type: "command"; command: string; timeout: number }>;
    }>;
  };
}

export function buildAgentSettings(): AgentSettings {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash|Edit|Write|NotebookEdit",
          hooks: [
            { type: "command", command: `node ${HOOK_SCRIPT_PATH}`, timeout: 5 },
          ],
        },
      ],
    },
  };
}

// Пишет user-level settings.json в контейнере агента. Идемпотентно (перезапись).
export function installSafetyHooks(): void {
  try {
    mkdirSync(CLAUDE_DIR, { recursive: true });
    writeFileSync(SETTINGS_PATH, JSON.stringify(buildAgentSettings(), null, 2));
    console.log(`[agent] safety hooks installed at ${SETTINGS_PATH}`);
  } catch (err) {
    console.warn("[agent] could not install safety hooks:", err);
  }
}
