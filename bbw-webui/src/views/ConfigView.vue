<script setup>
// 配置管理页:配置列表(本地保存/命名/导入导出)+ 原有配置备份功能
import { ref } from "vue";
import { state, pushLog, markDirty } from "../lib/store.js";
import { payloadToProfile, blankProfile } from "../lib/decode.js";
import { serializeProfile, parseWritePayload } from "../../../bbw-protocol/src/write-format.js";
import {
  loadConfigs,
  saveConfig,
  renameConfig,
  deleteConfig,
  clearConfigs,
  exportConfigList,
  exportConfigOne,
  parseConfigImport,
  mergeImportedConfigs,
} from "../lib/config-store.js";

const jsonText = ref("");     // 备份页:profile JSON / 508B hex 粘贴框
const fileText = ref("");     // 配置列表导入粘贴框
const configs = ref(loadConfigs());
const renaming = ref(null);
const renamingName = ref("");

function refresh() { configs.value = loadConfigs(); }

function promptName(title, fallback = "") {
  const name = window.prompt(title, fallback);
  return name === null ? null : name.trim();
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function boundCount(profile) { return (profile?.keys ?? []).filter((k) => k).length; }

/* ── 配置列表 ── */
function saveCurrent() {
  if (!state.profile) { pushLog("请先读取或导入一个配置"); return; }
  const name = promptName("为当前配置命名:", "我的配置");
  if (name === null) return;
  saveConfig(name, clone(state.profile));
  refresh();
  pushLog(`已保存配置「${name}」(${boundCount(state.profile)} 键)`);
}

async function readAndSave() {
  if (!state.transport) { pushLog("请先连接设备"); return; }
  try {
    pushLog("读取设备配置…");
    state.payload = await state.transport.readProfile();
    state.profile = payloadToProfile(state.payload);
    state.dirty = false;
    const name = promptName("为读取到的配置命名:", "设备配置");
    if (name === null) return;
    saveConfig(name, clone(state.profile));
    refresh();
    pushLog(`已从设备读取并保存为「${name}」(${boundCount(state.profile)} 键)`);
  } catch (e) {
    pushLog("读取失败: " + e.message);
  }
}

function loadConfig(c) {
  if (!confirm(`载入配置「${c.name}」覆盖当前编辑?(未点「写入」不会改动设备)`)) return;
  state.profile = clone(c.profile);
  markDirty();
  pushLog(`已载入配置「${c.name}」`);
}

function exportOne(c) {
  const blob = new Blob([exportConfigOne(c)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "bbw-config-" + c.name.replace(/[\\/:*?"<>|]/g, "_") + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
  pushLog(`已导出配置「${c.name}」`);
}

function startRename(c) { renaming.value = c.id; renamingName.value = c.name; }
function doRename(c) {
  const n = renamingName.value.trim();
  if (n && n !== c.name) { renameConfig(c.id, n); pushLog(`已重命名为「${n}」`); }
  renaming.value = null;
  refresh();
}
function doDelete(c) {
  if (!confirm(`删除配置「${c.name}」?`)) return;
  deleteConfig(c.id);
  refresh();
  pushLog(`已删除「${c.name}」`);
}
function doClearAll() {
  if (!configs.value.length) return;
  if (!confirm(`清空全部 ${configs.value.length} 个本地配置?`)) return;
  clearConfigs();
  refresh();
  pushLog("已清空配置列表");
}

function exportAll() {
  if (!configs.value.length) { pushLog("配置列表为空"); return; }
  const blob = new Blob([exportConfigList()], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "bbw-configs.json";
  a.click();
  URL.revokeObjectURL(a.href);
  pushLog(`已导出配置列表(${configs.value.length} 个)`);
}

function importText() {
  if (!fileText.value.trim()) { pushLog("请先粘贴配置列表 JSON 或选择文件"); return; }
  try {
    const list = parseConfigImport(fileText.value);
    const n = mergeImportedConfigs(list);
    refresh();
    pushLog(`已导入 ${n} 个配置`);
  } catch (e) {
    pushLog("导入失败: " + e.message);
  }
}
function onFile(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => { fileText.value = String(r.result || ""); importText(); };
  r.readAsText(f);
  e.target.value = "";
}

/* ── 备份 / 恢复(原 BackupView 功能) ── */
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
    <h2>配置列表</h2>
    <p class="desc">
      在本地浏览器保存多个命名配置(存于 localStorage)。「读取设备并保存」= 先读手柄当前配置再命名保存;
      「保存当前」= 把编辑器里的配置命名保存。整个列表可导出为文件,也可从文件/粘贴文本解析导入(同名覆盖)。
    </p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn primary" :disabled="!state.connected" @click="readAndSave">读取设备并保存</button>
      <button class="btn" :disabled="!state.profile" @click="saveCurrent">保存当前编辑</button>
      <button class="btn" :disabled="!configs.length" @click="exportAll">导出配置列表</button>
      <button class="btn danger" :disabled="!configs.length" @click="doClearAll">清空列表</button>
    </div>

    <table v-if="configs.length" class="tbl" style="margin-top:12px">
      <thead><tr><th>名称</th><th>键数</th><th>保存时间</th><th>操作</th></tr></thead>
      <tbody>
        <tr v-for="c in configs" :key="c.id">
          <td>
            <template v-if="renaming === c.id">
              <input v-model="renamingName" type="text" style="width:150px" @keydown.enter="doRename(c)" @keydown.esc="renaming = null">
            </template>
            <template v-else><b>{{ c.name }}</b></template>
          </td>
          <td>{{ boundCount(c.profile) }}</td>
          <td class="hint">{{ (c.updatedAt || c.createdAt || "").replace("T", " ").slice(0, 16) }}</td>
          <td style="white-space:nowrap">
            <button class="btn small primary" @click="loadConfig(c)">载入</button>
            <button class="btn small" @click="exportOne(c)">导出</button>
            <button v-if="renaming !== c.id" class="btn small" @click="startRename(c)">重命名</button>
            <button v-else class="btn small primary" @click="doRename(c)">确定</button>
            <button class="btn small danger" @click="doDelete(c)">删除</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="hint" style="margin-top:10px">暂无已保存配置 —— 点上方按钮保存第一个配置。</p>

    <h3>从文件 / 文本导入配置列表</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <input type="file" accept=".json,application/json" @change="onFile">
      <button class="btn primary" @click="importText">解析导入</button>
      <span class="hint">支持:配置列表 JSON / 单个配置 JSON / 纯 profile JSON</span>
    </div>
    <textarea v-model="fileText" rows="6" style="width:100%;margin-top:8px" placeholder="或把配置列表 JSON 粘贴到这里…"></textarea>
  </div>

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
