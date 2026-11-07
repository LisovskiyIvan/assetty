/**
 * Cross-tab background-job mirror of the backend's single pipeline gate.
 *
 * Each tab used to track only its own `running` flag, so while Optimize was
 * busy the Textures tab still offered Preview/Apply as if they were free —
 * the backend answered `{"error":"busy"}` instead. Tabs claim the bus when a
 * job (optimize / LODs / texture encode / apply / export copy) starts and
 * release it on the terminal event, so every surface can disable with a
 * visible reason instead of hitting the gate blindly.
 *
 * Lifecycle rule: the claim is released ONLY on the terminal event (the done
 * event, a synchronous completion, or a thrown call). Timeouts re-arm and
 * keep waiting, source/view switches and unmounts never release — while the
 * backend works, the mirror must stay busy. The backend stays the source of
 * truth: a backend `busy` rejection still releases a stale claim.
 */

export type JobKind = "optimize" | "lods" | "encode" | "apply" | "export";

export interface JobState {
  kind: JobKind | null;
  /** Cancel requested via cancelJob(): the terminal event is still pending. */
  cancelling: boolean;
}

let state: JobState = { kind: null, cancelling: false };
const listeners = new Set<(state: JobState) => void>();

function snapshot(): JobState {
  return { ...state };
}

function emit(): void {
  const snap = snapshot();
  for (const cb of listeners) {
    try {
      cb(snap);
    } catch {
      // a broken listener must never break job accounting
    }
  }
}

/** Current bus state (a copy). */
export function getJob(): JobState {
  return snapshot();
}

/** True while any primary job owns the backend gate (local mirror). */
export function isJobBusy(): boolean {
  return state.kind !== null;
}

/**
 * Takes the gate for `kind`. Returns false when another job owns it — the
 * caller should surface the busy hint instead of calling the backend.
 */
export function claimJob(kind: JobKind): boolean {
  if (state.kind !== null) return false;
  state = { kind, cancelling: false };
  emit();
  return true;
}

/** Releases the gate; only the owner can release (stale releases ignored). */
export function releaseJob(kind: JobKind): void {
  if (state.kind !== kind) return;
  state = { kind: null, cancelling: false };
  emit();
}

/** Marks the owner's cancel request (terminal event still pending). */
export function setJobCancelling(kind: JobKind, cancelling: boolean): void {
  if (state.kind !== kind) return;
  if (state.cancelling === cancelling) return;
  state = { ...state, cancelling };
  emit();
}

/** Subscribes to bus changes. Returns an unsubscribe function. */
export function onJobChange(cb: (state: JobState) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** i18n key for a human job name (`t(jobLabelKey(kind))`). */
export function jobLabelKey(kind: JobKind): string {
  switch (kind) {
    case "optimize":
      return "job.optimize";
    case "lods":
      return "job.lods";
    case "encode":
      return "job.encode";
    case "apply":
      return "job.apply";
    case "export":
      return "job.export";
  }
}

/**
 * True for the terminal event of a user-cancelled job (`ok: false, error:
 * "Cancelled"`). Cancel is neutral — never an error — and must not drop the
 * previous finished result. Lives here (not in guards.ts) so it stays
 * importable without DOM.
 */
export function isCancelledError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err ?? "");
  return /cancel/i.test(text);
}
