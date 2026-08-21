// 物理按键学习结果存储(localStorage 持久化)
// 结构: { "byte:bit": { name, code } } —— 键位 = IG_00 游戏手柄输入报告的 字节:位
// 默认锚点:固化学习结果(见 names.js KEY_NAMES,单一来源)
import { reactive } from "vue";
import { keyName, KEY_NAMES } from "./names.js";

const LS_KEY = "bbw-keynames";
const DEFAULTS = KEY_NAMES; // code → 默认名(已固化写测定位学习结果)

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch { return {}; }
}

export const namesStore = reactive({ map: load() });

export function saveName(bitKey, name, code) {
  namesStore.map[bitKey] = { name: name || keyName(code), code };
  persist();
}
export function removeName(bitKey) {
  delete namesStore.map[bitKey];
  persist();
}
function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(namesStore.map)); } catch {}
}

/** code → 名称(优先学习结果,其次默认锚点,最后 键N) */
export function nameOfCode(code) {
  for (const v of Object.values(namesStore.map)) {
    if (v.code === code) return v.name;
  }
  return DEFAULTS[code] ?? keyName(code);
}
/** 学习结果里已分配的名称表(code → name) */
export function codeNameMap() {
  const m = {};
  for (const [bitKey, v] of Object.entries(namesStore.map)) {
    if (v.code !== undefined && v.code !== null) m[v.code] = v.name;
    m[bitKey] = v.name; // 兼存 bitKey 便于展示
  }
  return m;
}
export const DEFAULT_CODES = DEFAULTS;
