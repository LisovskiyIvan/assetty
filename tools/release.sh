#!/bin/sh
# Cut a release: bump the version default, commit, tag, push.
# Usage: sh tools/release.sh 0.2.0 [--dry-run]
# The tag push makes GitHub Actions build all platforms and publish
# the release (see .github/workflows/release.yml).
set -eu

ver="${1:?usage: sh tools/release.sh <version> [--dry-run]}"
dry=""
if [ "${2:-}" = "--dry-run" ]; then dry="1"; fi

case "$ver" in
  *[!0-9.]* | "" | .* | *.) echo "release.sh: '$ver' is not a plain X.Y.Z version" >&2; exit 1;;
esac
case "$ver" in
  *..* | *.*.*.*) echo "release.sh: '$ver' is not a plain X.Y.Z version" >&2; exit 1;;
esac
case "$ver" in
  *.*.*) ;;
  *) echo "release.sh: '$ver' is not a plain X.Y.Z version (need major.minor.patch)" >&2; exit 1;;
esac

branch="$(git branch --show-current)"
if [ "$branch" != "main" ]; then echo "release.sh: on '$branch', want main" >&2; exit 1; fi
if ! git diff --quiet || [ -n "$(git status --porcelain)" ]; then
  echo "release.sh: tree not clean (commit or stash first)" >&2; exit 1
fi
if git rev-parse "v$ver" >/dev/null 2>&1; then echo "release.sh: tag v$ver exists" >&2; exit 1; fi

# Stale committed dist ships a stale GUI: the workflow rebuilds it anyway,
# but keep the reminder where the release is cut.
if [ -d app/web/src ] && [ app/web/src -nt app/web/dist/index.html ]; then
  echo "release.sh: warning: app/web/src is newer than app/web/dist (rebuild: cd app/web && bun install && bun run build)" >&2
fi

if [ -n "$dry" ]; then
  echo "dry-run: would set version default to $ver, commit, tag v$ver, push main + tag"
  exit 0
fi

sed -i.bak '/const version = b.option/s/orelse "[^"]*"/orelse "'"$ver"'"/' build.zig
rm -f build.zig.bak
grep -n 'const version = b.option' build.zig
git add build.zig
git commit -m "release v$ver"
git tag "v$ver"
git push origin main "v$ver"

repo="$(git remote get-url origin)"
repo="${repo#*github.com[:/]}"
repo="${repo%.git}"
echo "building: https://github.com/$repo/actions"
echo "release lands at: https://github.com/$repo/releases/tag/v$ver"
