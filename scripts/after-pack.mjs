// electron-builder afterPack — restore the executable bit on bundled native binaries.
//
// npm does not preserve the executable bit for files inside published packages, and
// electron-builder copies the mode it finds. So `bare-runtime`'s `bin/bare` — the process
// the QVAC inference worker runs in — lands in the bundle as 0644.
//
// bare-runtime compensates at runtime (lib/spawn.js):
//
//     fs.accessSync(bin, fs.constants.X_OK)   // throws
//     fs.chmodSync(bin, 0o755)                // repairs it
//
// That works from a writable install and fails on every read-only medium:
//
//     Linux AppImage   EACCES  spawn .../bin/bare        (squashfs mount)
//     macOS DMG        EROFS   chmod .../bin/bare        (read-only volume)
//
// Both were reported against real installs. Setting the bit here means the runtime repair
// is never needed, so the app works from the AppImage directly and from the mounted DMG,
// instead of only after being copied somewhere writable.
import { chmod, readdir, stat, copyFile, mkdir, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);

/** Directories whose contents are executables that must keep the bit. */
const BIN_DIR = 'bin';
/**
 * Skip trees that cannot contain native launchers, so this stays fast on a 1.6 GB app.
 *
 * Deliberately NOT skipping `app`: the packaged tree is `resources/app/node_modules/...`,
 * so excluding that name skips the entire application and the hook silently finds
 * nothing — which is exactly what the first version of this did.
 */
const SKIP = new Set(['.git', 'locales']);

async function fixBinaries(dir, found = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found; // unreadable dir — nothing to do
  }

  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);

    if (e.isDirectory()) {
      await fixBinaries(full, found);
      continue;
    }
    if (!e.isFile()) continue;

    // Only touch files that live in a bin/ directory — that is where these packages put
    // their launchers, and it avoids chmod-ing data files that merely look binary.
    if (path.basename(dir) !== BIN_DIR) continue;

    try {
      const s = await stat(full);
      if (s.mode & 0o111) continue; // already executable
      await chmod(full, 0o755);
      found.push(full);
    } catch {
      // A file we cannot stat or chmod is not worth failing the build over.
    }
  }
  return found;
}

/**
 * Vendor the OpenSSL dylibs the macOS prebuilds link by absolute path.
 *
 * Two of the vendor's darwin-arm64 prebuilds (llm-llamacpp, embed-llamacpp) are linked
 * against Homebrew's OpenSSL at a hardcoded absolute path:
 *
 *     otool -L qvac__llm-llamacpp.bare
 *         /opt/homebrew/opt/openssl@3/lib/libssl.3.dylib
 *         /opt/homebrew/opt/openssl@3/lib/libcrypto.3.dylib
 *
 * On any Mac without Homebrew that path does not exist, dlopen fails, and the inference
 * worker dies — surfacing much later as "RPC initialization timed out after 30000ms". The
 * Linux prebuilds link normally and are unaffected.
 *
 * Downloading a DMG should not require installing a package manager first, so the dylibs
 * are copied in beside each prebuild and the load commands rewritten to @loader_path. The
 * build machine still needs them present to copy FROM; without them this reports what is
 * missing and changes nothing, leaving a build that works only where Homebrew is.
 */
const OPENSSL_LIBS = ['libssl.3.dylib', 'libcrypto.3.dylib'];
const BREW_OPENSSL = '/opt/homebrew/opt/openssl@3/lib';

async function findPrebuilds(dir, out = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { await findPrebuilds(full, out); continue; }
    if (e.isFile() && e.name.endsWith('.bare')) out.push(full);
  }
  return out;
}

async function linksBrewOpenssl(file) {
  try {
    const { stdout } = await run('otool', ['-L', file]);
    return stdout.includes(BREW_OPENSSL);
  } catch {
    return false; // otool absent or unreadable — nothing we can assert
  }
}

async function vendorOpensslForMac(appOut) {
  const prebuilds = await findPrebuilds(appOut);
  const needy = [];
  for (const f of prebuilds) if (await linksBrewOpenssl(f)) needy.push(f);
  if (!needy.length) return;

  console.log(`  • afterPack: ${needy.length} macOS prebuild(s) link OpenSSL by absolute path`);

  for (const lib of OPENSSL_LIBS) {
    try { await access(path.join(BREW_OPENSSL, lib)); }
    catch {
      console.warn(`  • afterPack: ${lib} not found in ${BREW_OPENSSL} — cannot vendor it.`);
      console.warn('  •           the built app will only run where Homebrew openssl@3 is installed.');
      console.warn('  •           install it on this build machine (brew install openssl@3) and rebuild.');
      return;
    }
  }

  for (const bin of needy) {
    const dir = path.dirname(bin);
    try {
      await mkdir(dir, { recursive: true });
      for (const lib of OPENSSL_LIBS) {
        const dest = path.join(dir, lib);
        await copyFile(path.join(BREW_OPENSSL, lib), dest);
        await chmod(dest, 0o755);
        // The dylib records its own install name; leave it resolvable next to the addon.
        await run('install_name_tool', ['-id', `@loader_path/${lib}`, dest]).catch(() => {});
        await run('install_name_tool', ['-change', `${BREW_OPENSSL}/${lib}`, `@loader_path/${lib}`, bin]);
        // Re-sign the dylib we just rewrote. install_name_tool edits the Mach-O in place,
        // which invalidates whatever signature it carried.
        await run('codesign', ['--force', '--sign', '-', '--timestamp=none', dest]).catch(() => {});
      }
      // And the addon itself, for the same reason. On Apple Silicon every Mach-O must carry
      // a valid signature — ad-hoc is enough — or dlopen refuses it outright, which would
      // trade a missing-library failure for a code-signature one.
      await run('codesign', ['--force', '--sign', '-', '--timestamp=none', bin]);
      console.log(`      vendored OpenSSL beside ${path.relative(appOut, bin)} (re-signed)`);
    } catch (e) {
      console.warn(`  • afterPack: could not rewrite ${path.relative(appOut, bin)}: ${e.message}`);
    }
  }
}

export default async function afterPack(context) {
  const appOut = context.appOutDir;

  if (context.electronPlatformName === 'darwin') {
    await vendorOpensslForMac(appOut);
  }

  const fixed = await fixBinaries(appOut);

  if (fixed.length === 0) {
    console.log('  • afterPack: no non-executable bin/ files found');
    return;
  }
  console.log(`  • afterPack: restored the executable bit on ${fixed.length} bundled binaries`);
  for (const f of fixed) console.log(`      ${path.relative(appOut, f)}`);
}
