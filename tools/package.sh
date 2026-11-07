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

case "$os" in
  macos)
    # Ship an .app bundle: Finder runs a bare unix executable through
    # Terminal (a CLI window opens first), a bundle opens the GUI directly.
    # The updater finds the program inside by basename (findProgram), so the
    # zip layout change needs no updater changes.
    mkdir -p "out/$folder/assetty.app/Contents/MacOS" "out/$folder/assetty.app/Contents/Resources"
    cp "$bin" "out/$folder/assetty.app/Contents/MacOS/assetty"
    cp app/resources/assetty.icns "out/$folder/assetty.app/Contents/Resources/assetty.icns"
    cp tools/install-cli.sh "out/$folder/assetty.app/Contents/Resources/install-cli.sh"
    cat > "out/$folder/assetty.app/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key><string>assetty</string>
	<key>CFBundleIdentifier</key><string>io.github.LisovskiyIvan.assetty</string>
	<key>CFBundleName</key><string>assetty</string>
	<key>CFBundleDisplayName</key><string>assetty</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>$ver</string>
	<key>CFBundleVersion</key><string>$ver</string>
	<key>LSMinimumSystemVersion</key><string>12.0</string>
	<key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
	<key>NSHighResolutionCapable</key><true/>
	<key>CFBundleIconFile</key><string>assetty.icns</string>
	<key>CFBundleDocumentTypes</key>
	<array><dict>
		<key>CFBundleTypeName</key><string>GLB 3D model</string>
		<key>CFBundleTypeRole</key><string>Viewer</string>
		<key>LSHandlerRank</key><string>Alternate</string>
		<key>LSItemContentTypes</key><array><string>org.khronos.glb</string></array>
	</dict></array>
	<key>UTImportedTypeDeclarations</key>
	<array><dict>
		<key>UTTypeIdentifier</key><string>org.khronos.glb</string>
		<key>UTTypeDescription</key><string>GLB 3D model</string>
		<key>UTTypeConformsTo</key><array><string>public.data</string></array>
		<key>UTTypeTagSpecification</key><dict>
			<key>public.filename-extension</key><array><string>glb</string></array>
			<key>public.mime-type</key><string>model/gltf-binary</string>
		</dict>
	</dict></array>
</dict>
</plist>
EOF
    cat > "out/$folder/NOTES.txt" <<EOF
assetty $ver for macOS 12+ ($arch).

Drag assetty.app to Applications, then double-click it to open the desktop app.
Open With assetty in Finder, or drop a .glb on its Dock icon.
First launch of a downloaded, unsigned app: macOS Gatekeeper may refuse —
right-click the app and pick Open once (or: xattr -dr com.apple.quarantine assetty.app).

CLI (same binary, full toolkit):
  /Applications/assetty.app/Contents/MacOS/assetty help
Optional command installation (no sudo):
  sh /Applications/assetty.app/Contents/Resources/install-cli.sh
The installer creates ~/.local/bin/assetty; follow its PATH instruction if needed.

Settings: ~/Library/Application Support/assetty/
Temporary results: ~/Library/Caches/assetty/results/
EOF
    ;;
  windows)
    cp "$bin" "out/$folder/"
    test -f zig-out/bin/WebView2Loader.dll || { echo 'package.sh: run tools/fetch-webview2.ps1 before packaging Windows' >&2; exit 1; }
    cp zig-out/bin/WebView2Loader.dll "out/$folder/"
    cp zig-out/bin/LICENSE.txt "out/$folder/WebView2-LICENSE.txt"
    cat > "out/$folder/NOTES.txt" <<EOF
assetty $ver for Windows x64.

The desktop UI needs the WebView2 runtime (preinstalled on Windows 10/11).
Without it the app opens a native notice window pointing at the CLI,
where the full toolkit stays available.
EOF
    ;;
  linux)
    cp "$bin" "out/$folder/"
    cp app/resources/assetty.svg "out/$folder/assetty.svg"
    cp tools/install-desktop.sh "out/$folder/install.sh"
    cat > "out/$folder/NOTES.txt" <<EOF
assetty $ver for Linux $arch.

The desktop UI needs GTK3/GTK4 at runtime plus WebKitGTK 2.40+
(Debian/Ubuntu: sudo apt install libwebkitgtk-6.0-4 or libwebkit2gtk-4.1-0).
Without it the app opens a native notice window pointing at the CLI,
where the full toolkit stays available.

Install the application launcher and CLI for your user (no sudo):
  sh install.sh
The launcher opens the GUI without a terminal and supports .glb files.
EOF
    ;;
  *) echo "package.sh: unknown os '$os' (macos|windows|linux)" >&2; exit 1 ;;
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
