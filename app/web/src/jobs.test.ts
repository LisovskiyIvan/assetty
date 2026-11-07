/**
 * Focused unit tests for the job-gate mirror (jobs.ts): claim/release
 * lifecycle, cancelling flag, change notifications, and the neutral
 * cancelled-error matcher. Run with `bun test` (no extra dependencies).
 */
import { describe, expect, test } from "bun:test";
import {
  claimJob,
  getJob,
  isCancelledError,
  isJobBusy,
  jobLabelKey,
  onJobChange,
  releaseJob,
  setJobCancelling,
} from "./jobs";
import type { JobKind, JobState } from "./jobs";

const KINDS: JobKind[] = ["optimize", "lods", "encode", "apply", "export"];

function reset(): void {
  for (const kind of KINDS) releaseJob(kind);
}

describe("job mirror lifecycle", () => {
  test("starts free", () => {
    reset();
    expect(getJob()).toEqual({ kind: null, cancelling: false });
    expect(isJobBusy()).toBe(false);
  });

  test("claim takes the gate, second claim fails", () => {
    reset();
    expect(claimJob("optimize")).toBe(true);
    expect(getJob().kind).toBe("optimize");
    expect(isJobBusy()).toBe(true);
    expect(claimJob("encode")).toBe(false);
    expect(getJob().kind).toBe("optimize");
    releaseJob("optimize");
    expect(isJobBusy()).toBe(false);
  });

  test("only the owner can release (stale releases ignored)", () => {
    reset();
    expect(claimJob("lods")).toBe(true);
    releaseJob("encode");
    expect(getJob().kind).toBe("lods");
    setJobCancelling("encode", true);
    expect(getJob().cancelling).toBe(false);
    releaseJob("lods");
    expect(getJob().kind).toBe(null);
  });

  test("cancelling flag is owner-scoped and resets on release", () => {
    reset();
    expect(claimJob("apply")).toBe(true);
    setJobCancelling("apply", true);
    expect(getJob()).toEqual({ kind: "apply", cancelling: true });
    setJobCancelling("apply", true); // idempotent
    releaseJob("apply");
    expect(getJob()).toEqual({ kind: null, cancelling: false });
  });

  test("export participates in the same gate", () => {
    reset();
    expect(claimJob("export")).toBe(true);
    expect(claimJob("optimize")).toBe(false);
    expect(jobLabelKey("export")).toBe("job.export");
    releaseJob("export");
    expect(claimJob("optimize")).toBe(true);
    releaseJob("optimize");
  });

  test("listeners see every transition", () => {
    reset();
    const seen: JobState[] = [];
    const off = onJobChange((state) => seen.push(state));
    claimJob("encode");
    setJobCancelling("encode", true);
    releaseJob("encode");
    off();
    claimJob("optimize"); // after unsubscribe: no record
    releaseJob("optimize");
    expect(seen).toEqual([
      { kind: "encode", cancelling: false },
      { kind: "encode", cancelling: true },
      { kind: null, cancelling: false },
    ]);
  });

  test("snapshot is a copy", () => {
    reset();
    expect(claimJob("optimize")).toBe(true);
    const snap = getJob();
    snap.kind = null;
    expect(getJob().kind).toBe("optimize");
    releaseJob("optimize");
  });
});

describe("isCancelledError", () => {
  test("matches the backend Cancelled terminal event", () => {
    expect(isCancelledError("Cancelled")).toBe(true);
    expect(isCancelledError(new Error("Cancelled"))).toBe(true);
    expect(isCancelledError("ok: false, error: cancelled by user")).toBe(true);
  });

  test("rejects real failures and busy signals", () => {
    expect(isCancelledError("optimize failed: out of memory")).toBe(false);
    expect(isCancelledError("optimize already running")).toBe(false);
    expect(isCancelledError('{"error":"busy"}')).toBe(false);
    expect(isCancelledError("")).toBe(false);
    expect(isCancelledError(null)).toBe(false);
    expect(isCancelledError(undefined)).toBe(false);
  });
});
