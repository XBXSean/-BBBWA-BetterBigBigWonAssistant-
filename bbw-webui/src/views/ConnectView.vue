<script setup>
import { state, pushLog } from "../lib/store.js";
import { HidTransport } from "../lib/transport.js";
import { ref } from "vue";

const info = ref(null);
const emit = defineEmits(["read"]);

async function connect() {
  try {
    const t = new HidTransport();
    const { config, gamepad } = await t.connect();
    state.transport = t;
    state.connected = true;
    pushLog("已连接配置通道 " + config.productName + (gamepad ? " + 游戏手柄通道" : "(未找到游戏手柄通道)"));
    const fmt = (d) => (d ? d.collections.map((c) => ({
      usagePage: "0x" + c.usagePage.toString(16),
      usage: "0x" + (c.usage ?? 0).toString(16),
      in: c.inputReports.map((r) => r.reportLength),
      out: c.outputReports.map((r) => r.reportLength),
    })) : null);
    info.value = { 配置通道: fmt(config), 游戏手柄通道: fmt(gamepad) };
    // 自动读取配置(连接后即载入)
    setTimeout(() => emit("read"), 150);
  } catch (e) {
    pushLog("连接失败: " + e.message);
    state.lastError = e.message;
  }
}

function disconnect() {
  if (state.transport) state.transport.disconnect();
  state.transport = null;
  state.connected = false;
  state.payload = null;
  state.profile = null;
  state.dirty = false;
  pushLog("已断开");
}
</script>

<template>
  <div class="card">
    <h2>连接设备</h2>
    <p class="desc">
      通过 WebHID 访问 MI_02 供应商配置通道(65B 报告,usagePage 0xFF7A)。
      连接后同时监听 IG_00 游戏手柄输入(用于「按键映射 → 物理按键学习」)。
    </p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button v-if="!state.connected" class="btn primary" @click="connect">请求授权并连接</button>
      <button v-else class="btn" @click="disconnect">断开</button>
      <button class="btn" :disabled="!state.connected" @click="$emit('read')">读取当前配置</button>
    </div>
    <pre v-if="info" class="log" style="margin-top:12px">{{ JSON.stringify(info, null, 1) }}</pre>
  </div>

  <div v-if="state.profile" class="card">
    <h2>当前配置摘要</h2>
    <div class="grid">
      <div class="field"><label>扳机死区</label><span>左 {{ state.profile.deadzone.c0 }}..{{ state.profile.deadzone.s0 }} / 右 {{ state.profile.deadzone.c1 }}..{{ state.profile.deadzone.s1 }}</span></div>
      <div class="field"><label>键位绑定</label><span>{{ state.profile.keys.filter((k) => k).length }} / 32 条</span></div>
      <div class="field"><label>摇杆曲线</label><span>6 槽({{ state.profile.curves.filter((c) => c.points.some((v) => v !== 0)).length }} 已配置)</span></div>
      <div class="field"><label>体感</label><span>sensor={{ state.profile.motion.sensorMode }} enum={{ state.profile.motion.enumSensorMode }} simKeys={{ state.profile.motion.simKeys.join(",") || "无" }}</span></div>
      <div class="field"><label>震动区</label><span class="hexrow">{{ state.profile.shock.bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ") }}</span></div>
      <div class="field"><label>校验</label>
        <span class="badge ok">CRC-16/MODBUS</span>
      </div>
    </div>
  </div>
</template>
