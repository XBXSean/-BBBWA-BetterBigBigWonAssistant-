<script setup>
import { ref } from "vue";
import { state, pushLog, markDirty } from "../lib/store.js";
import { payloadToProfile, blankProfile } from "../lib/decode.js";
import { serializeProfile, parseWritePayload } from "../../../bbw-protocol/src/write-format.js";

const jsonText = ref("");

function exportJson() {
  if (!state.profile) return;
  const blob = new Blob([JSON.stringify(state.profile, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "bbw-profile.json";
  a.click();
  URL.revokeObjectURL(a.href);
  pushLog("已导出 profile JSON");
}

function importJson() {
  try {
    const obj = JSON.parse(jsonText.value);
    if (!obj.deadzone || !Array.isArray(obj.keys) || (!Array.isArray(obj.curves) && !Array.isArray(obj.triggers))) {
      throw new Error("JSON 缺少 deadzone/keys/curves 字段");
    }
    state.profile = obj;
    markDirty();
    pushLog("已导入 profile JSON(" + obj.keys.length + " 键)");
  } catch (e) {
    pushLog("导入失败: " + e.message);
  }
}

function payloadToJson() {
  if (!state.payload) return;
  jsonText.value = "// 508B hex\n" + [...state.payload].map((b) => "0x" + b.toString(16).padStart(2, "0")).join(" ");
  pushLog("已导出 508B hex");
}

function newProfile() {
  if (!confirm("用空白 profile 覆盖当前编辑?(写回时未编辑字段仍保留设备原值)")) return;
  state.profile = blankProfile();
  markDirty();
}

function verifyChecksum() {
  if (!state.profile) return;
  try {
    const p = serializeProfile(state.profile, state.payload ?? null);
    const parsed = parseWritePayload(p);
    pushLog(`本地校验: 0x${parsed.checksum16.toString(16).padStart(4, "0")} ${parsed.checksumOk ? "✅" : "❌"}`);
  } catch (e) {
    pushLog("序列化失败: " + e.message);
  }
}
</script>

<template>
  <div class="card">
    <h2>配置备份 / 恢复</h2>
    <p class="desc">导出当前编辑为 JSON;导入覆盖编辑(写回时未覆盖字段保留设备原值,安全)。</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" @click="exportJson">导出 JSON</button>
      <button class="btn" @click="payloadToJson">导出 508B hex</button>
      <button class="btn" @click="verifyChecksum">本地校验</button>
      <button class="btn" @click="newProfile">空白 profile</button>
    </div>
    <div style="margin-top:12px">
      <textarea v-model="jsonText" rows="8" placeholder="粘贴 profile JSON 或 508B hex 到这里…"></textarea>
      <div style="margin-top:8px"><button class="btn primary" @click="importJson">导入 JSON</button></div>
    </div>
  </div>

  <div v-if="state.payload" class="card">
    <h2>设备原始 508B(最近一次读取)</h2>
    <pre class="log">{{ [...state.payload].map((b) => b.toString(16).padStart(2, "0")).join(" ") }}</pre>
  </div>
</template>
