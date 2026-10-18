#!/usr/bin/env bash
# Downloads the pinned, official Obsidian desktop build (Linux AppImage) and the Fantasy
# Statblocks release used by the real-app E2E. Verifies the Obsidian checksum.
set -euo pipefail
OBSIDIAN_VERSION="${OBSIDIAN_VERSION:-1.14.4}"
OBSIDIAN_SHA256="${OBSIDIAN_SHA256:-6362ddbeeeebb7bbccb48fae009572cf2284ef92f5c919c1332aba48de6ffeaa}"
FSB_VERSION="${FSB_VERSION:-4.10.3}"
CACHE="${CACHE:-$(cd "$(dirname "$0")/.." && pwd)/.cache}"
mkdir -p "$CACHE/obsidian" "$CACHE/fsb"
cd "$CACHE/obsidian"
if [ ! -x squashfs-root/obsidian ]; then
	curl -fsSL -o obsidian.AppImage "https://github.com/obsidianmd/obsidian-releases/releases/download/v${OBSIDIAN_VERSION}/Obsidian-${OBSIDIAN_VERSION}.AppImage"
	echo "${OBSIDIAN_SHA256}  obsidian.AppImage" | sha256sum -c -
	chmod +x obsidian.AppImage
	./obsidian.AppImage --appimage-extract >/dev/null
fi
cd "$CACHE/fsb"
for f in main.js manifest.json styles.css; do
	[ -f "$f" ] || curl -fsSL -o "$f" "https://github.com/Obsidian-TTRPG-Community/fantasy-statblocks/releases/download/${FSB_VERSION}/$f"
done
echo "OBSIDIAN_BIN=$CACHE/obsidian/squashfs-root/obsidian"
echo "FSB_DIR=$CACHE/fsb"
