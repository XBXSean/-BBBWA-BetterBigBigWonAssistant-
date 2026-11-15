/**
 * 全局状态（单例）。所有页面只读写这里，不各自持有副本。
 *
 * draft 是唯一可写副本；base 是设备上次读回的原值，用来算差异与"未保存"提示。
 */
import { reactive, computed } from "vue";
import { Transport } from "./transport.js";
import { readModel, writeModel, diffPayload, extendCrc } from "./model.js";
import { DEFAULT_508 } from "./default-config.js";
import { mockLog, onMockChange, mockReset } from "./mock-hid.js";
import { groupDiff } from "./diff-items.js";

export const transport = new Transport();

export const state = reactive({
  route: "dashboard",
  theme: "dark",
  connected: false,
  mock: false,
  info: null,
  base: null,
  draft: null,
  busy: false,
  lastReadAt: 0,
  lastWriteAt: 0,
  toasts: [],
  log: [],
  autoWrite: false,
  showTech: false,
  confirm: null,
});

export const model = computed(() => (state.draft ? readModel(state.draft) : null));
export const diff = computed(() => (state.base && state.draft ? diffPayload(state.base, state.draft) : []));
export const dirty = computed(() => diff.value.length > 0);
/** 按「设置项」折叠后的差异，界面报数用这个而不是字节数 */
export const diffItems = computed(() => groupDiff(diff.value));
export const mlog = computed(() => { void mockTick.value; return mockLog.slice(-40); });

const mockTick = reactive({ n: 0 });
onMockChange(() => { mockTick.n++; });

/* ---------------- 提示 / 日志 ---------------- */

let toastId = 0;
export function toast(text, kind = "ok", ms = 2600) {
  const id = ++toastId;
  state.toasts.push({ id, text, kind });
  setTimeout(() => {
    const i = state.toasts.findIndex((t) => t.id === id);
    if (i >= 0) state.toasts.splice(i, 1);
  }, ms);
}

export function log(text) {
  state.log.push({ t: new Date(), text });
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
}

/* ---------------- 主题 ---------------- */

export function applyTheme(mode) {
  state.theme = mode;
  const dark = mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.classList.toggle("light", !dark);
  try { localStorage.setItem("bbw-console-theme", mode); } catch {}
}

export function cycleTheme() {
  applyTheme(state.theme === "dark" ? "light" : "dark");
}

/* ---------------- 路由（hash 驱动，可深链） ---------------- */

export const ROUTES = [
  { id: "dashboard", label: "状态", group: "概览", icon: "gauge" },
  { id: "mapping", label: "按键映射", group: "配置", icon: "keys" },
  { id: "sticks", label: "摇杆", group: "配置", icon: "stick" },
  { id: "triggers", label: "扳机", group: "配置", icon: "trigger" },
  { id: "motion", label: "体感", group: "配置", icon: "motion" },
  { id: "shock", label: "震动", group: "配置", icon: "vibe" },
  { id: "debug", label: "调试", group: "工具", icon: "code" },
  { id: "backup", label: "备份", group: "工具", icon: "archive" },
  { id: "about", label: "关于", group: "工具", icon: "info" },
];

export function go(id) {
  if (!ROUTES.some((r) => r.id === id)) id = "dashboard";
  state.route = id;
  try { location.hash = "#/" + id; } catch {}
}

export function initRoute() {
  const id = (location.hash || "").replace(/^#\/?/, "") || "dashboard";
  go(id);
  addEventListener("hashchange", () => {
    const next = (location.hash || "").replace(/^#\/?/, "") || "dashboard";
    if (next !== state.route) go(next);
  });
}

/* ---------------- 连接 / 读 / 写 ---------------- */

export async function connect(mock = false) {
  state.busy = true;
  try {
    const info = await transport.connect({ mock });
    state.connected = true;
    state.mock = !!info.mock;
    state.info = info;
    log(`已连接：${info.productName}${info.mock ? "（模拟）" : ""}`);
    toast(info.mock ? "已连接模拟设备" : "已连接", "ok");
    await read();
    go("dashboard");
  } catch (e) {
    log(`连接失败：${e.message}`);
    toast(e.message, "err", 4200);
  } finally {
    state.busy = false;
  }
}

export function disconnect() {
  transport.disconnect();
  state.connected = false;
  state.mock = false;
  state.info = null;
  state.base = null;
  state.draft = null;
  log("已断开");
  toast("已断开", "warn");
}

export async function read() {
  if (!state.connected) return;
  state.busy = true;
  const t0 = performance.now();
  try {
    const p = await transport.readProfile();
    state.base = p;
    state.draft = Uint8Array.from(p);
    state.lastReadAt = Date.now();
    const m = readModel(p);
    log(`读取完成：508B / ${Math.round(performance.now() - t0)}ms / CRC ${m.crcOk ? "自洽" : "异常"}`);
    if (!m.crcOk) toast("读回的 CRC 不自洽，谨慎写入", "warn", 4000);
  } catch (e) {
    log(`读取失败：${e.message}`);
    toast("读取失败：" + e.message, "err", 4000);
  } finally {
    state.busy = false;
  }
}

export async function write(opts = {}) {
  if (!state.connected || !state.draft) return;
  state.busy = true;
  try {
    const p = extendCrc(state.draft);
    const changed = diffPayload(state.base ?? p, p);
    await transport.writeProfile(p);
    state.lastWriteAt = Date.now();
    log(`写入完成：${p.length}B / 9 帧 / ${changed.length} 字节变化`);
    const n = groupDiff(changed).length;
    if (opts.auto) toast(`已自动写入（${n} 项）`, "ok", 1800);
    else toast(`已写入设备（${n} 项设置）`, "ok");
    await read();
    // [304] 变更会触发 USB 重枚举，真机上需要重新连接
    if (changed.some((c) => c.off === 304) && !state.mock) {
      toast("体感模式变更会触发 USB 重枚举，如无响应请重新连接", "warn", 6000);
    }
  } catch (e) {
    log(`写入失败：${e.message}`);
    toast("写入失败：" + e.message, "err", 4200);
  } finally {
    state.busy = false;
  }
}

/** 顶栏「写入设备」走这里：自动写入开启时按钮是灰的，未开启时先确认 */
export function requestWrite() {
  if (!state.connected || !dirty.value) return;
  if (state.autoWrite) return;
  state.confirm = { kind: "write", count: diffItems.value.length, mock: state.mock };
}

export function closeConfirm() {
  state.confirm = null;
}

export function acceptConfirm() {
  const c = state.confirm;
  state.confirm = null;
  if (c?.kind === "write") write();
}

/* ---------------- 偏好 ---------------- */

function savePref(k, v) {
  try { localStorage.setItem(k, v); } catch {}
}

export function setAutoWrite(v) {
  state.autoWrite = !!v;
  savePref("bbw-auto-write", state.autoWrite ? "1" : "0");
  clearTimeout(autoTimer);
  if (state.autoWrite && dirty.value) autoTimer = setTimeout(() => write({ auto: true }), 60);
}

export function setShowTech(v) {
  state.showTech = !!v;
  savePref("bbw-show-tech", state.showTech ? "1" : "0");
  document.documentElement.classList.toggle("show-tech", state.showTech);
}

let autoTimer = 0;
function scheduleAutoWrite() {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    if (state.autoWrite && dirty.value && !state.busy) write({ auto: true });
  }, 500);
}

/* ---------------- 编辑 ---------------- */

/** 所有编辑都走这里：只写指定字段，CRC 延迟到写入时统一重算 */
export function edit(edits) {
  if (!state.draft) return;
  state.draft = writeModel(state.draft, edits);
  if (state.autoWrite) scheduleAutoWrite();
}

export function revert() {
  if (!state.base) return;
  state.draft = Uint8Array.from(state.base);
  toast("已撤销修改", "warn");
}

export function factoryReset() {
  if (!state.draft) return;
  const d = Uint8Array.from(DEFAULT_508);
  state.draft = extendCrc(d);
  toast("已套用默认配置，未写入", "warn", 3600);
}

export function resetMockDevice() {
  state.draft = mockReset();
  state.base = Uint8Array.from(state.draft);
  toast("模拟设备已恢复出厂", "ok");
}

/* ---------------- 初始化 ---------------- */

export function init() {
  let mode = "dark";
  try { mode = localStorage.getItem("bbw-console-theme") || "dark"; } catch {}
  applyTheme(mode);
  try {
    state.autoWrite = localStorage.getItem("bbw-auto-write") === "1";
    state.showTech = localStorage.getItem("bbw-show-tech") === "1";
  } catch {}
  document.documentElement.classList.toggle("show-tech", state.showTech);
  initRoute();
}
