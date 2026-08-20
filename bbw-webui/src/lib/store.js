// 全局状态(单例 reactive)
import { reactive } from "vue";

export const state = reactive({
  connected: false,
  transport: null,   // HidTransport 实例
  payload: null,     // 最近读取的 508B(Uint8Array)
  profile: null,     // 可编辑 profile 模型(payloadToProfile 输出)
  dirty: false,      // 是否有未写回修改
  log: [],
  lastError: "",
});

export function pushLog(msg) {
  state.log.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
}

export function markDirty() { state.dirty = true; }
