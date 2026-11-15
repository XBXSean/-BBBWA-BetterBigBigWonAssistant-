<script setup>
import { ref } from "vue";
import { state, model, factoryReset, read, write, toast, edit } from "../core/store.js";
import { mockReset } from "../core/mock-hid.js";

const fileInput = ref(null);
const name = ref("bbw-508");

function saveBin() {
  const blob = new Blob([state.draft], { type: "application/octet-stream" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name.value || "bbw-508"}.bin`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("已导出 bin");
}

function saveJson() {
  const m = model.value;
  const data = {
    format: "bbw-508b",
    savedAt: new Date().toISOString(),
    crc: "0x" + m.crc.toString(16).padStart(4, "0"),
    bytes: [...state.draft],
    summary: {
      trigger: m.trigger,
      hire: m.hire,
      sticks: { left: { deadzone: m.sticks.left.deadzone, points: m.sticks.left.points },
        right: { deadzone: m.sticks.right.deadzone, points: m.sticks.right.points } },
      motion: { mode: m.motion.mode, respond: m.motion.respond, invertX: m.motion.invertX, invertY: m.motion.invertY },
    },
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name.value || "bbw-508"}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("已导出 json");
}

async function onFile(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    if (f.name.endsWith(".json")) {
      const j = JSON.parse(await f.text());
      const arr = j.bytes;
      if (!Array.isArray(arr) || arr.length !== 508) throw new Error("JSON 里没有 508 字节");
      state.draft = Uint8Array.from(arr);
    } else {
      const buf = new Uint8Array(await f.arrayBuffer());
      if (buf.length !== 508) throw new Error(`文件为 ${buf.length}B，需要 508B`);
      state.draft = buf;
    }
    toast("已载入，写入前请先核对差异", "ok", 3600);
  } catch (err) {
    toast("载入失败：" + err.message, "err", 4000);
  }
  e.target.value = "";
}
</script>

<template>
  <div class="grid c2">
    <div class="card">
      <div class="card-head"><div class="grow"><h2>导出</h2><p>当前编辑中的配置，未写入也可导出。</p></div></div>
      <div class="row" style="margin-bottom:12px">
        <input class="input" v-model="name" placeholder="文件名" style="flex:1" />
      </div>
      <div class="row">
        <button class="btn" @click="saveBin">导出 bin（508B）</button>
        <button class="btn" @click="saveJson">导出 json</button>
      </div>
      <div class="hint" style="margin-top:10px">bin 可直接被官方工具与其它脚本读取；json 额外带解析后的摘要。</div>
    </div>

    <div class="card">
      <div class="card-head"><div class="grow"><h2>导入</h2><p>只载入到编辑区，确认后需点写入。</p></div></div>
      <input ref="fileInput" type="file" accept=".bin,.json" style="display:none" @change="onFile" />
      <button class="btn block" style="height:38px" @click="fileInput.click()">选择文件</button>
      <div class="hint" style="margin-top:10px">支持 508 字节 bin，或本工具导出的 json。</div>
    </div>

    <div class="card">
      <div class="card-head"><div class="grow"><h2>恢复</h2><p>恢复出厂只改编辑区，不会自动下发。</p></div></div>
      <div class="row">
        <button class="btn danger" @click="factoryReset">套用官方默认</button>
        <button class="btn" :disabled="!state.connected" @click="read">从设备重读</button>
      </div>
      <div v-if="state.mock" class="row" style="margin-top:10px">
        <button class="btn" @click="mockReset()">模拟设备恢复出厂</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="grow"><h2>当前</h2></div></div>
      <table class="tbl">
        <tbody>
          <tr><td class="hint">来源</td><td>{{ state.mock ? '模拟设备' : 'USB 设备' }}</td></tr>
          <tr><td class="hint">CRC</td><td class="mono">0x{{ model?.crc.toString(16).toUpperCase().padStart(4, '0') }}</td></tr>
          <tr><td class="hint">最近写入</td><td>{{ state.lastWriteAt ? new Date(state.lastWriteAt).toLocaleTimeString() : '—' }}</td></tr>
        </tbody>
      </table>
      <button class="btn primary block" style="margin-top:12px" :disabled="!state.connected" @click="write">写入设备</button>
    </div>
  </div>
</template>
