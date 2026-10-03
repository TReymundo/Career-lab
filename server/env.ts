import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Credentials live in .env and nowhere else. When the app offers a "connect" button, this is
 * what it writes to — the same file you would have edited by hand — and the running process
 * picks the values up immediately, so nothing needs a restart.
 */
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env');

export function setEnv(values: Record<string, string>) {
  const lines = existsSync(envPath) ? readFileSync(envPath, 'utf8').split(/\r?\n/) : [];
  for (const [key, value] of Object.entries(values)) {
    const at = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (value) {
      const line = `${key}=${value}`;
      if (at >= 0) lines[at] = line; else lines.push(line);
      process.env[key] = value;
    } else {
      if (at >= 0) lines.splice(at, 1);
      delete process.env[key];
    }
  }
  writeFileSync(envPath, `${lines.filter((l, i) => l.trim() || i < lines.length - 1).join('\n').trim()}\n`);
}
