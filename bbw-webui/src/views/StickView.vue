<script setup>
import { state, markDirty } from "../lib/store.js";

const dz = state.profile.deadzone;
const num = (v) => (Number.isFinite(v) ? v : 0);
const hexIn = (v) => "0x" + (v ?? 0).toString(16).padStart(2, "0");
const stickHex = () => (state.profile.stickArea || []).map((b) => b.toString(16).padStart(2, "0")).join(" ");

function setStickHex(s) {
  const parts = (s || "").trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length !== 35) return;
  const arr = parts.map((p) => parseInt(p, 16));
  if (arr.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return;
  state.profile.stickArea = arr;
  markDirty();
}
</script>

<template>
  <div class="split">
    <div class="col">
      <div class="card">
        <h2>左扳机</h2>
        <p class="desc">[5][6] 下限/上限(上限存 100-值);hire0 在 [4] bit0</p>
        <div class="grid">
          <div class="field">
            <label>下限 c0 [5]</label>
            <input type="number" min="0" max="100" :value="num(dz.c0)" @input="dz.c0 = Math.max(0, Math.min(100, +$event.target.value || 0)); markDirty()">
          </div>
          <div class="field">
            <label>上限 s0 [6] = 100-值</label>
            <input type="number" min="0" max="100" :value="num(dz.s0)" @input="dz.s0 = Math.max(0, Math.min(100, +$event.target.value || 0)); markDirty()">
          </div>
          <div class="field">
            <label>hire0 [4] bit0</label>
            <input type="checkbox" v-model="dz.hire0" @change="markDirty()">
          </div>
        </div>
      </div>
    </div>
    <div class="col">
      <div class="card">
        <h2>右扳机</h2>
        <p class="desc">[7][8] 下限/上限(上限存 100-值);hire1 在 [4] bit1</p>
        <div class="grid">
          <div class="field">
            <label>下限 c1 [7]</label>
            <input type="number" min="0" max="100" :value="num(dz.c1)" @input="dz.c1 = Math.max(0, Math.min(100, +$event.target.value || 0)); markDirty()">
          </div>
          <div class="field">
            <label>上限 s1 [8] = 100-值</label>
            <input type="number" min="0" max="100" :value="num(dz.s1)" @input="dz.s1 = Math.max(0, Math.min(100, +$event.target.value || 0)); markDirty()">
          </div>
          <div class="field">
            <label>hire1 [4] bit1</label>
            <input type="checkbox" v-model="dz.hire1" @change="markDirty()">
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>功能位 [12][13]</h2>
    <div class="grid">
      <div class="field">
        <label>功能位 [12]</label>
        <input type="text" :value="hexIn(state.profile.featFlags[0])" @change="state.profile.featFlags[0] = parseInt($event.target.value, 16) || 0; markDirty()">
      </div>
      <div class="field">
        <label>功能位 [13]</label>
        <input type="text" :value="hexIn(state.profile.featFlags[1])" @change="state.profile.featFlags[1] = parseInt($event.target.value, 16) || 0; markDirty()">
      </div>
    </div>
  </div>

  <div class="card">
    <h2>摇杆响应曲线区 [309..343](raw 透传)</h2>
    <p class="desc">
      该区域目前以原始字节透传(35B hex),写回时未修改字段自动保留设备原值。
      如你在官方软件中调整摇杆响应并观察到本区域变化,欢迎提交 Issue 反馈,帮助完善解析。
    </p>
    <div class="field">
      <label>35B hex(空格分隔)</label>
      <input type="text" style="width:100%" :value="stickHex()" @change="setStickHex($event.target.value)">
    </div>
    <p class="hint" style="margin-top:6px">当前:{{ stickHex() }}</p>
  </div>
</template>
