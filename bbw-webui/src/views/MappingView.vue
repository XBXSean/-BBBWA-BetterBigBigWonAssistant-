<script setup>
import { state, markDirty } from "../lib/store.js";
import { slotToCode } from "../lib/names.js";
import { nameOfCode } from "../lib/names-store.js";
import KeyRow from "../components/KeyRow.vue";
import KeyLearn from "../components/KeyLearn.vue";

// 空条目占位;code 必须 = slotToCode(槽位)(写回时按 code 定位槽)
function ensureRow(i) {
  if (!state.profile.keys[i]) {
    state.profile.keys[i] = { code: slotToCode(i), type: 0, enabled: false, keys: [] };
  }
  return state.profile.keys[i];
}
</script>

<template>
  <KeyLearn />

  <div class="card">
    <h2>按键映射</h2>
    <p class="desc">
      键 0..3 = M1..M4;其余按键名称可用上方「物理按键学习」自定义。
      type=单键/组合 时 keys 为<b>物理按键码</b>;宏A 时 keys 为<b>键盘键</b>;enabled 仅镜像使能位图(宏绑定不依赖它)。
    </p>
    <table class="tbl">
      <thead><tr><th>按键</th><th>类型</th><th>enabled</th><th>绑定内容</th></tr></thead>
      <tbody>
        <KeyRow v-for="i in 32" :key="i - 1" :entry="ensureRow(i - 1)" :name="nameOfCode(state.profile.keys[i - 1]?.code ?? slotToCode(i - 1))" />
      </tbody>
    </table>
  </div>
</template>
