// 物理按键学习结果存储(localStorage 持久化)
// 结构: { "byte:bit": { name, code } } —— 键位 = IG_00 游戏手柄输入报告的 字节:位
// 默认锚点:键 0..3 = M1..M4
import { reactive } from "vue";
import { keyName } from "./names.js";

const LS_KEY = "bbw-keynames";
const DEFAULTS = { 0: "M1", 1: "M2", 2: "M3", 3: "M4", 4: "A", 5: "B", 6: "X", 7: "Y" };

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
