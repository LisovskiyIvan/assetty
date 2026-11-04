#!/bin/sh
# Run assetty info/optimize/textures over the fuzz corpus, triage results.
# Usage: sh test/fuzz_run.sh [corpus_dir]
# Prints: crashes (signal), hangs (>10s), unexpected-OK on garbage.
CORPUS="${1:-test/corpus}"
BIN="./zig-out/bin/assetty"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
crash=0; hang=0; ok=0; clean=0
# macOS has no `timeout(1)`; emulate with perl (exit 124 on hang, like GNU).
run_limited() {
    perl -e '$t=shift; $SIG{ALRM}=sub{exit 124}; alarm($t); $r=system(@ARGV); exit($r==0?0:$r>>8);' 10 "$@"
}
for f in "$CORPUS"/*.glb; do
    for cmd in "info" "textures" "optimize --preset mobile -o $TMP/o.glb"; do
        # shellcheck disable=SC2086
        run_limited "$BIN" $cmd "$f" >"$TMP/out" 2>&1
        rc=$?
        if [ $rc -gt 128 ] || [ $rc -eq 134 ] || [ $rc -eq 139 ]; then
            echo "CRASH rc=$rc: $cmd $f"
            crash=$((crash+1))
        elif [ $rc -eq 124 ]; then
            echo "HANG: $cmd $f"
            hang=$((hang+1))
        elif [ $rc -eq 0 ]; then
            ok=$((ok+1))
        else
            clean=$((clean+1))
        fi
    done
done
echo "runs: crash=$crash hang=$hang exit0=$ok clean-error=$clean"
