// Encrypted wallet keystore — the user's BIP-39 mnemonic, locked with a password.
//
// Uses ethers' standard encrypted-keystore JSON (audited scrypt + AES + MAC) — NO custom crypto.
// The mnemonic is decrypted only into the engine's memory after unlock; it never reaches the browser.
// At-rest protection is the password; the installed (Electron) app will layer the OS keychain on top.
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Wallet, getAddress, type HDNodeWallet } from 'ethers';

export interface UnlockedWallet {
  mnemonic: string;
  address: string;
}

export function keystorePath(): string {
  return process.env.CONDUIT_KEYSTORE || path.join(os.homedir(), '.conduit', 'keystore.json');
}

export function exists(): boolean {
  return existsSync(keystorePath());
}

// The wallet address, readable WITHOUT the password (the keystore JSON stores it in clear).
// Lets the locked screen show "unlock 0x1234…" before any password is entered.
export function readAddress(): string | null {
  try {
    const meta = JSON.parse(readFileSync(keystorePath(), 'utf8'));
    return meta.address ? getAddress('0x' + String(meta.address).replace(/^0x/, '')) : null;
  } catch {
    return null;
  }
}

function writeKeystore(json: string): void {
  const p = keystorePath();
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, json, { mode: 0o600 }); // owner-only
}

export async function create(password: string): Promise<UnlockedWallet> {
  const w = Wallet.createRandom();
  const phrase = w.mnemonic!.phrase;
  writeKeystore(await w.encrypt(password));
  return { mnemonic: phrase, address: w.address };
}

export async function importMnemonic(phrase: string, password: string): Promise<UnlockedWallet> {
  const clean = phrase.trim().replace(/\s+/g, ' ');
  let w: HDNodeWallet;
  try {
    w = Wallet.fromPhrase(clean);
  } catch {
    throw new Error('invalid recovery phrase');
  }
  writeKeystore(await w.encrypt(password));
  return { mnemonic: clean, address: w.address };
}

export async function unlock(password: string): Promise<UnlockedWallet> {
  const json = readFileSync(keystorePath(), 'utf8');
  let w: Wallet | HDNodeWallet;
  try {
    w = await Wallet.fromEncryptedJson(json, password);
  } catch {
    throw new Error('wrong password');
  }
  const phrase = (w as HDNodeWallet).mnemonic?.phrase;
  if (!phrase) throw new Error('keystore has no recovery phrase');
  return { mnemonic: phrase, address: w.address };
}

// Forget the wallet on this machine (the user keeps their backed-up phrase).
export function remove(): void {
  try { rmSync(keystorePath()); } catch { /* nothing to remove */ }
}
