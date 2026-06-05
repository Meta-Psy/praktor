#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const AUDIT_LOG = path.join(os.homedir(), '.claude', 'audit.log');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    if (process.stdin.isTTY) resolve('{}');
  });
}

function logAudit(entry) {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(AUDIT_LOG, line, 'utf8');
  } catch (_) { /* never crash the hook */ }
}

function block(reason, entry) {
  logAudit({ decision: 'block', reason, ...entry });
  process.stderr.write(`safety-guard: BLOCKED — ${reason}\n`);
  process.exit(2);
}

function allow(_entry) {
  process.exit(0);
}

const SAFE_RM_PREFIXES = [
  'node_modules', 'dist', '.venv', '__pycache__',
  '.next', 'build', 'target', 'out', '.cache', 'coverage',
];

const ENV_FILE_PATTERN = /(^|[\\/])\.env(\.[\w-]+)?$/i;
const ENV_EXAMPLE_PATTERN = /(^|[\\/])\.env\.example$/i;

function isProtectedEnvPath(p) {
  if (!p) return false;
  if (ENV_EXAMPLE_PATTERN.test(p)) return false;
  return ENV_FILE_PATTERN.test(p);
}

// Strip bash HEREDOC bodies so Tier-3 patterns mentioned in PR/commit text
// are not matched as exec-level commands. Matches <<WORD, <<'WORD', <<"WORD",
// <<-WORD (tab-stripped). Replacement keeps a space so adjacent tokens stay separated.
const HEREDOC_PATTERN = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n[ \t]*\2(?=\s|$)/g;

function stripHeredocs(cmd) {
  return cmd.replace(HEREDOC_PATTERN, ' ');
}

function checkBash(cmd, entry) {
  const c = stripHeredocs(cmd).trim();

  if (/\bgit\s+push\b.*(--force\b|-f\b|--force-with-lease\b)/.test(c)) {
    block('force-push запрещён', entry);
  }

  if (/\bgit\s+push\b.*\b(main|master)\b/.test(c)) {
    block('push в main/master запрещён', entry);
  }

  if (/\bgit\s+reset\s+--hard\b/.test(c)) {
    block('git reset --hard запрещён', entry);
  }

  if (/\bgit\s+commit\b.*--no-verify\b/.test(c) ||
      /\bgit\s+commit\b.*--no-gpg-sign\b/.test(c)) {
    block('commit с обходом hooks/sign запрещён', entry);
  }

  if (/\b(psql|sqlite3?)\b.*\b(DROP\s+TABLE|TRUNCATE|DELETE\s+FROM)\b/i.test(c)) {
    block('destructive SQL через CLI запрещён', entry);
  }

  const rmMatch = c.match(/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-rf|-fr)\s+([^\s;|&]+)/);
  if (rmMatch) {
    const target = rmMatch[2].replace(/^['"]/, '').replace(/['"]$/, '');
    if (target === '/' || target === '~' || target === 'C:/' || target === 'C:\\') {
      block(`rm -rf на корень (${target}) запрещён`, entry);
    }
    const firstSeg = target.split(/[\\/]/)[0];
    if (!SAFE_RM_PREFIXES.includes(firstSeg)) {
      block(`rm -rf вне build/cache путей запрещён: ${target}`, entry);
    }
  }

  allow(entry);
}

function checkEditOrWrite(filePath, entry) {
  if (isProtectedEnvPath(filePath)) {
    block(`edit/write на ${filePath} запрещён (env/secrets)`, entry);
  }
  if (/(secrets|credentials)\.(json|ya?ml|env)$/i.test(filePath)) {
    block(`edit/write на secrets/credentials запрещён: ${filePath}`, entry);
  }
  allow(entry);
}

(async () => {
  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const tool = payload.tool_name || payload.tool || '';
  const input = payload.tool_input || payload.input || {};
  const entry = { tool, input };

  if (tool === 'Bash') {
    const cmd = input.command || '';
    if (!cmd) allow(entry);
    return checkBash(cmd, { ...entry, tier: 2 });
  }

  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
    const fp = input.file_path || input.path || '';
    return checkEditOrWrite(fp, entry);
  }

  allow(entry);
})();
