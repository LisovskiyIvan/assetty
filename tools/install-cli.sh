#!/bin/sh
# Run from the installed bundle: sh assetty.app/Contents/Resources/install-cli.sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
program=$(CDPATH= cd -- "$here/../MacOS" && pwd)/assetty
prefix=${ASSETTY_BIN_DIR:-"$HOME/.local/bin"}
mkdir -p "$prefix"
if [ -e "$prefix/assetty" ] && [ ! -L "$prefix/assetty" ]; then
  echo "Refusing to replace an existing command: $prefix/assetty" >&2
  exit 1
fi
ln -sfn "$program" "$prefix/assetty"
echo "Installed: $prefix/assetty"
case ":$PATH:" in
  *":$prefix:"*) echo 'Try: assetty help' ;;
  *) printf 'Add this directory to your shell PATH:\n  export PATH="%s:$PATH"\n' "$prefix" ;;
esac
