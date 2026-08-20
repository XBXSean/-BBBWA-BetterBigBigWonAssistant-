<script setup>
import { state, markDirty } from "../lib/store.js";

const m = state.profile.motion;
const sh = state.profile.shock;
const clamp = (v, lo = 0, hi = 255) => Math.max(lo, Math.min(hi, v));
const SIM_OPTIONS = Array.from({ length: 21 }, (_, i) => i);

function toggleSimKey(k) {
  const i = m.simKeys.indexOf(k);
  if (i >= 0) m.simKeys.splice(i, 1); else m.simKeys.push(k);
  m.simKeys.sort((a, b) => a - b);
  markDirty();
}
</script>

<template>
  <div class="card">
    <h2>体感 Motion</h2>
    <div class="grid">
      <div class="field">
        <label>sensorMode [304] 高4位</label>
        <input type="number" min="0" max="15" :value="m.sensorMode" @input="m.sensorMode = clamp(+$event.target.value || 0, 0, 15); markDirty()">
      </div>
      <div class="field">
        <label>enumSensorMode [304] 低4位</label>
        <input type="number" min="0" max="15" :value="m.enumSensorMode" @input="m.enumSensorMode = clamp(+$event.target.value || 0, 0, 15); markDirty()">
      </div>
      <div class="field">
        <label>轴反转/模式位 [311]</label>
        <input type="text" style="width:72px" :value="'0x' + (m.axisFlags ?? 0).toString(16)" @change="m.axisFlags = parseInt($event.target.value, 16) || 0; markDirty()">
      </div>
      <div class="field">
        <label>sim_keys(体感触发键)</label>
        <div style="max-width:440px">
          <span v-for="k in SIM_OPTIONS" :key="k" class="chip" :class="{ on: m.simKeys.includes(k) }" @click="toggleSimKey(k)">
            键{{ k }}
          </span>
        </div>
      </div>
    </div>
    <h3>陀螺仪原始字节 [312..318]</h3>
    <div class="grid" style="grid-template-columns:repeat(7,58px)">
      <div class="field" v-for="(g, i) in m.gyro" :key="i">
        <label>g{{ i }}</label>
        <input type="text" style="width:54px" :value="'0x' + (g ?? 0).toString(16)" @change="m.gyro[i] = parseInt($event.target.value, 16) || 0; markDirty()">
      </div>
    </div>
  </div>

  <div class="card">
    <h2>震动 [352..360]</h2>
    <p class="desc">9 字节原始透传(布局未定,不猜)。设备默认 00 00 32 32 01 01 c8 c8 22;末字节为档位。</p>
    <div class="grid" style="grid-template-columns:repeat(9,58px)">
      <div class="field" v-for="(b, i) in sh.bytes" :key="i">
        <label>[{{ 352 + i }}]</label>
        <input type="text" style="width:54px" :value="'0x' + (b ?? 0).toString(16).padStart(2, '0')" @change="sh.bytes[i] = clamp(parseInt($event.target.value, 16) || 0); markDirty()">
      </div>
    </div>
  </div>
</template>
