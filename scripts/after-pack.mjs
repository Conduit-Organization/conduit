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
import { chmod, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

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

export default async function afterPack(context) {
  const appOut = context.appOutDir;
  const fixed = await fixBinaries(appOut);

  if (fixed.length === 0) {
    console.log('  • afterPack: no non-executable bin/ files found');
    return;
  }
  console.log(`  • afterPack: restored the executable bit on ${fixed.length} bundled binaries`);
  for (const f of fixed) console.log(`      ${path.relative(appOut, f)}`);
}
