/** Backend discovery: probing window globals for a nanoui host object. */
import type { NativeBackend } from "./types";
import { parseMaybeJson } from "./events";

const METHOD_NAMES = [
  "openDialog",
  "pickSavePath",
  "exportTo",
  "info",
  "loadBytes",
  "optimize",
  "optimizeCustom",
  "textures",
  "texturePreview",
  "textureEncode",
  "diff",
  "lint",
  "discardFile",
  "presets",
  "presetLoad",
  "presetSave",
  "settingsLoad",
  "settingsSave",
  "dropFile",
  "openDialogAt",
  "listDir",
] as const;

type AnyFn = (...args: unknown[]) => unknown;

/** Collects a backend object that implements enough of our methods to be trusted. */
function probeObject(name: string, obj: Record<string, unknown>): NativeBackend | null {
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
  const ns = w["nanoui"] as Record<string, unknown> | undefined;
  if (ns && typeof ns === "object") {
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

  // 2. a bound backend object on the global scope (app.bind(&backend) -> window.backend)
  const preferred = ["assetty", "Assetty", "backend", "Backend", "app", "App", "api", "host"];
  for (const key of preferred) {
    const val = w[key];
    if (val && typeof val === "object") {
      const probed = probeObject(`window.${key}`, val as Record<string, unknown>);
      if (probed) return probed;
    }
  }
  for (const key of Object.getOwnPropertyNames(w)) {
    if (preferred.includes(key)) continue;
    let val: unknown;
    try {
      val = w[key];
    } catch {
      continue;
    }
    if (!val || typeof val !== "object") continue;
    const probed = probeObject(`window.${key}`, val as Record<string, unknown>);
    if (probed) return probed;
  }

  // 3. flat globals: prefix_method, e.g. window.backend_info(...)
  const groups = new Map<string, Map<string, AnyFn>>();
  for (const key of Object.getOwnPropertyNames(w)) {
    const m =
      /^(.+?)_(openDialog|info|loadBytes|optimize|optimizeCustom|textures|texturePreview|textureEncode|diff|lint|discardFile|presets|presetLoad|presetSave|settingsLoad|settingsSave)$/.exec(
        key,
      );
    if (!m) continue;
    const val = w[key];
    if (typeof val !== "function") continue;
    const group = groups.get(m[1]) ?? new Map<string, AnyFn>();
    group.set(m[2], val as AnyFn);
    groups.set(m[1], group);
  }
  for (const [prefix, group] of groups) {
    if (group.size < 2) continue;
    return {
      source: `window.${prefix}_*`,
      methods: [...group.keys()],
      call: async (method, args) => {
        const fn = group.get(method);
        if (!fn) throw new Error(`backend method ${method} not exposed`);
        return await fn(...args);
      },
      on: () => () => {},
    };
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
  const parsed = parseMaybeJson<unknown>(result);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const message = (parsed as Record<string, unknown>).error;
    if (typeof message === "string" && message.trim()) throw new Error(message);
  }
  return result;
}
