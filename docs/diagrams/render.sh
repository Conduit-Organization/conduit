#!/usr/bin/env bash
# Re-render all Conduit architecture diagrams to SVG (zoom-proof) + high-res PNG.
# Requires Node.js. Uses mermaid-cli via npx (downloads a headless browser on first run).
set -euo pipefail
cd "$(dirname "$0")"
for f in *.mmd; do
  base="${f%.mmd}"
  echo "rendering $base ..."
  npx -y @mermaid-js/mermaid-cli@11 -i "$f" -o "$base.svg" -p puppeteer.json -c mermaid-config.json -b white
  npx -y @mermaid-js/mermaid-cli@11 -i "$f" -o "$base.png" -p puppeteer.json -c mermaid-config.json -b white -s 3
done
echo "done -> $(ls *.svg 2>/dev/null | wc -l) SVG + $(ls *.png 2>/dev/null | wc -l) PNG"
