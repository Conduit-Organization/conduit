// Safe access to the Electron preload bridge (window.conduit). In a plain browser (vite dev or the
// engine's web build) it's undefined, so every call degrades to a no-op and desktop-only features
// (the "remember on this device" checkbox) simply don't render.
interface ConduitSecret {
  available(): Promise<boolean>;
  set(v: string): Promise<boolean>;
  get(): Promise<string | null>;
  clear(): Promise<boolean>;
}
interface ConduitBridge {
  desktop?: boolean;
  platform?: string;
  secret?: ConduitSecret;
}

function bridge(): ConduitBridge | null {
  return typeof window !== 'undefined' ? ((window as unknown as { conduit?: ConduitBridge }).conduit ?? null) : null;
}

export const isDesktop = (): boolean => !!bridge()?.desktop;

export async function secretAvailable(): Promise<boolean> {
  const b = bridge();
  if (!b?.secret) return false;
  try { return await b.secret.available(); } catch { return false; }
}

export async function rememberPassword(pw: string): Promise<void> {
  const b = bridge();
  if (!b?.secret) return;
  try { await b.secret.set(pw); } catch { /* keychain unavailable — silently skip */ }
}

export async function getRememberedPassword(): Promise<string | null> {
  const b = bridge();
  if (!b?.secret) return null;
  try { return await b.secret.get(); } catch { return null; }
}

export async function forgetPassword(): Promise<void> {
  const b = bridge();
  if (!b?.secret) return;
  try { await b.secret.clear(); } catch { /* ignore */ }
}
