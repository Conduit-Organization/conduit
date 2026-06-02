// Minimal .env loader (no dependency). Reads KEY=VALUE lines, strips surrounding quotes.
import { readFileSync } from 'node:fs';

export function loadEnv(path = '.env'): Record<string, string> {
  const out: Record<string, string> = {};
  let txt = '';
  try {
    txt = readFileSync(path, 'utf8');
  } catch {
    return out;
  }
  for (const line of txt.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
