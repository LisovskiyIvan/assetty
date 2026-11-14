#!/bin/sh
# Installs the unpacked Linux build for the current user, without sudo.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
data=${XDG_DATA_HOME:-"$HOME/.local/share"}
lib="$HOME/.local/lib/assetty"
bin="$HOME/.local/bin"
mkdir -p "$lib" "$bin" "$data/applications" "$data/icons/hicolor/scalable/apps"
if [ -e "$bin/assetty" ] && [ ! -L "$bin/assetty" ]; then
  echo "Refusing to replace an existing command: $bin/assetty" >&2
  exit 1
fi
cp "$here/assetty" "$lib/assetty.new"
chmod 755 "$lib/assetty.new"
mv -f "$lib/assetty.new" "$lib/assetty"
ln -sfn "$lib/assetty" "$bin/assetty"
cp "$here/assetty.svg" "$data/icons/hicolor/scalable/apps/assetty.svg"
# Desktop Entry Exec double-quoting has its own escaping rules.
exec_path=$(printf '%s' "$lib/assetty" | sed 's/[\\"`$]/\\\\&/g')
cat > "$data/applications/assetty.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=assetty
Comment=View and optimize glTF/GLB models
Exec="$exec_path" --app --open %F
Icon=assetty
Terminal=false
Categories=Development;Graphics;3DGraphics;
MimeType=model/gltf-binary;model/gltf+json;
EOF
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$data/applications" || true
fi
echo "Installed application launcher and CLI: $bin/assetty"
case ":$PATH:" in
  *":$bin:"*) ;;
  *) printf 'For CLI use, add to your shell PATH:\n  export PATH="%s:$PATH"\n' "$bin" ;;
esac
