// The root package.json is `"type": "module"`, which would make Node treat the compiled
// electron/dist/*.js as ESM — but tsc emits CommonJS for the Electron main/preload. A nested
// package.json marks just that directory as CommonJS, so `main.js`/`preload.js` load correctly
// (in `electron:dev` and inside the packaged app).
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('electron/dist', { recursive: true });
writeFileSync('electron/dist/package.json', JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
console.log('✓ wrote electron/dist/package.json (type: commonjs)');
