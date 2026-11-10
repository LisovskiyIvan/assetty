/** Backend discovery: probing window globals for a nanoui host object. */
import type { NativeBackend } from "./types";
import { isRecord, parseMaybeJson } from "./events";

const METHOD_NAMES = [
  "openDialog",
  "pickSavePath",
  "exportTo",
  "cancelJob",
  "pendingOpenFiles",
  "info",
  "loadBytes",
  "optimize",
  "optimizeCustom",
  "optimizeLODs",
  "textures",
  "texturePreview",
  "textureEncode",
  "discardFile",
  "presets",
  "presetLoad",
  "presetSave",
  "presetSaveJson",
  "presetDelete",
  "settingsLoad",
  "settingsSave",
  "appInfo",
  "updateCheck",
  "updateApply",
  "dropFile",
  "openDialogAt",
  "listDir",
] as const;

type AnyFn = (...args: unknown[]) => unknown;

/**
 * Core pipeline entry points: every flow starts with `info` (file open) and
 * runs through `optimize`. A candidate that lacks either as a function is not
 * a backend we can trust — reject it instead of failing at first call.
 */
const REQUIRED_METHODS = ["info", "optimize"] as const;

/** Collects a backend object that implements enough of our methods to be trusted. */
function probeObject(name: string, obj: Record<string, unknown>): NativeBackend | null {
  if (!REQUIRED_METHODS.every((m) => typeof obj[m] === "function")) return null;
  const methods = METHOD_NAMES.filter((m) => typeof obj[m] === "function");
  if (methods.length < 2) return null;
  return {
    source: name,
    methods,
    call: (method, args) => Promise.resolve((obj[method] as AnyFn)(...args)),
    on: (event, cb) => subscribeObject(obj, event, cb),
  };
}

function subscribeObject(
  obj: Record<string, unknown>,
  event: string,
  cb: (payload: unknown) => void,
): () => void {
  for (const key of ["on", "addEventListener", "subscribe"]) {
    const fn = obj[key];
    if (typeof fn === "function") {
      const off = (fn as AnyFn).call(obj, event, cb);
      return typeof off === "function" ? (off as () => void) : () => {};
    }
  }
  return () => {};
}

export function findNative(): NativeBackend | null {
  const w = window as unknown as Record<string, unknown>;

  // 1. explicit namespace object: window.nanoui = { invoke(method, ...args) } or { method() {} }
  let ns: unknown;
  try {
    ns = w["nanoui"];
  } catch {
    ns = undefined;
  }
  if (isRecord(ns)) {
    if (typeof ns["invoke"] === "function") {
      const invoke = ns["invoke"] as AnyFn;
      return {
        source: "window.nanoui.invoke",
        methods: [...METHOD_NAMES],
        call: (method, args) => Promise.resolve(invoke.call(ns, method, ...args)),
        on: (event, cb) => subscribeObject(ns, event, cb),
      };
    }
    const probed = probeObject("window.nanoui", ns);
    if (probed) return probed;
  }

  // 2. a bound backend object on a known global (app.bind(&backend) target).
  // Deliberately a closed list: sweeping every window property is slow,
  // brittle, and can fire arbitrary getters as a side effect.
  const preferred = ["nanoui", "assettyNative", "assetty", "bridge", "host"];
  for (const key of preferred) {
    if (key === "nanoui") continue; // handled above (namespace or invoke style)
    let val: unknown;
    try {
      val = w[key];
    } catch {
      continue;
    }
    if (isRecord(val)) {
      const probed = probeObject(`window.${key}`, val);
      if (probed) return probed;
    }
  }

  return null;
}

/** Host call with tolerant JSON parsing and `{ error }` payload surfacing. */
export async function rawCall(
  native: NativeBackend,
  method: string,
  args: unknown[],
): Promise<unknown> {
  if (!native.methods.includes(method)) throw new Error(`backend has no ${method}()`);
  const result = await native.call(method, args);
  const parsed = parseMaybeJson(result);
  if (isRecord(parsed)) {
    const message = parsed.error;
    if (typeof message === "string" && message.trim()) throw new Error(message);
  }
  return result;
}
