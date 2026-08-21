<script setup>
import { computed } from "vue";
import { state } from "../lib/store.js";
import { slotToCode } from "../lib/names.js";
import { keyCodeToBitmap, bitmapToSlot } from "../../../bbw-protocol/src/keymap.js";
import { nameOfCode } from "../lib/names-store.js";
import KeyRow from "../components/KeyRow.vue";
import KeyLearn from "../components/KeyLearn.vue";

// 行 = 有效物理键码 0..24(键码 → 槽位);code=-1 的无效槽位隐藏;按键码升序
const rows = computed(() => {
  const out = [];
  for (let code = 0; code <= 24; code++) {
    const slot = bitmapToSlot(keyCodeToBitmap(code));
    if (slot === -1) continue;
    out.push({ code, slot });
  }
  return out;
});

// 空条目占位;code 必须 = slotToCode(槽位)(写回时按 code 定位槽)
function ensureRow(i) {
  if (!state.profile.keys[i]) {
    state.profile.keys[i] = { code: slotToCode(i), type: 0, enabled: false, keys: [] };
  }
  return state.profile.keys[i];
}
</script>

<template>
  <div class="card">
    <h2>按键映射</h2>
    <p class="desc">
      按键名已固化(写测定位学习结果:4=A 5=B 6=X 7=Y 8=↑ 9=↓ 10=← 11=→ 12=LB 13=LT 14=RB 15=RT
      16=左摇杆按下 17=右摇杆按下 18=截图键 19=菜单键 20=视图键 21..24=功能键1..4);
      code=-1 的无效槽位已隐藏,按键码 0..24 升序排列(0..2 未学习,默认名 M1/M2/M3)。
      type=单键/组合 时 keys 为<b>物理按键码</b>;宏A 时 keys 为<b>键盘键</b>;enabled 仅镜像使能位图(宏绑定不依赖它)。
    </p>
    <table class="tbl">
      <thead><tr><th>按键</th><th>类型</th><th>enabled</th><th>绑定内容</th></tr></thead>
      <tbody>
        <KeyRow v-for="r in rows" :key="r.code" :entry="ensureRow(r.slot)" :name="nameOfCode(r.code)" />
      </tbody>
    </table>
  </div>

  <KeyLearn />
</template>
