#!/bin/sh
# Package the built binary into the release archive for one platform.
# Usage: sh tools/package.sh <version> <os> <arch> <ext>
#   e.g. sh tools/package.sh 0.2.0 macos arm64 zip
# Names must match app/src/update.zig (assetFor) — the in-app updater
# downloads exactly these.
set -eu

ver="$1"
os="$2"
arch="$3"
ext="$4"

bin="zig-out/bin/assetty"
if [ "$os" = "windows" ]; then bin="$bin.exe"; fi
test -f "$bin" || { echo "package.sh: $bin not built" >&2; exit 1; }

folder="assetty-$ver-$os-$arch"
rm -rf "out/$folder"
mkdir -p "out/$folder"
cp "$bin" "out/$folder/"

case "$os" in
  windows)
    cat > "out/$folder/NOTES.txt" <<EOF
assetty $ver for Windows x64.

The desktop UI needs the WebView2 runtime (preinstalled on Windows 10/11).
Without it the app opens a native notice window pointing at the CLI,
where the full toolkit stays available.
EOF
    ;;
  linux)
    cat > "out/$folder/NOTES.txt" <<EOF
assetty $ver for Linux $arch.

The desktop UI needs GTK3/GTK4 at runtime plus WebKitGTK 2.40+
(Debian/Ubuntu: sudo apt install libwebkitgtk-6.0-4 or libwebkit2gtk-4.1-0).
Without it the app opens a native notice window pointing at the CLI,
where the full toolkit stays available.
EOF
    ;;
esac

asset="assetty-$os-$arch.$ext"
rm -f "out/$asset"
if [ "$ext" = "zip" ]; then
  # bsdtar on macOS and Windows (tar.exe) writes zips; GNU tar is never
  # asked to (Linux ships .tar.gz).
  tar -a -c -f "out/$asset" -C out "$folder"
else
  tar -czf "out/$asset" -C out "$folder"
fi
rm -rf "out/$folder"
echo "packaged out/$asset"
