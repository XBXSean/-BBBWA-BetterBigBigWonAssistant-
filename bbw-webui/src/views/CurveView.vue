<script setup>
// 摇杆设置:左右两纵列。左 = L-默认/L-C1/L-C2(槽0/2/4),右 = R-默认/R-C1/R-C2(槽1/3/5)
// 槽结构:[0..1]=01 20 [2]=中心正 [3]=中心负 [4..11]=4 曲线点
//        [12]=外圈死区(100-补码) [13]=上限输出 [14]=稳定系数 [24..47]=扩展键映射
import { state, markDirty } from "../lib/store.js";
import { vkName } from "../lib/names.js";
import CurveEditor from "../components/CurveEditor.vue";

const LEFT = [0, 2, 4];
const RIGHT = [1, 3, 5];
const NAME = ["默认", "Curve1", "Curve2"];
const clamp = (v, lo = 0, hi = 255) => Math.max(lo, Math.min(hi, v));
const i16 = (v) => Math.max(-32768, Math.min(32767, v));

function addExtKey(group, vk) {
  if (vk === "" || vk === undefined) return;
  const n = Number(vk);
  if (!group.entry.keys.includes(n)) { group.entry.keys.push(n); markDirty(); }
}
</script>

<template>
  <div class="split">
    <div v-for="side in ['left', 'right']" :key="side" class="col">
      <h2 style="margin-bottom:10px">{{ side === 'left' ? '左摇杆' : '右摇杆' }}</h2>

      <!-- 摇杆中心死区(默认槽 [2][3])+ 外圈死区(默认槽 [12]) -->
      <div class="card">
        <h2>{{ side === 'left' ? '左' : '右' }}摇杆死区</h2>
        <p class="desc">
          中心死区 = 默认槽 [2][3];<b>外圈死区 = 默认槽 [12](100-补码存储,
          设 33 → 流[26]=0x43=67)</b>。
        </p>
        <div class="grid">
          <div class="field">
            <label>中心死区 正半程 [2]</label>
            <input type="number" min="0" max="100" :value="state.profile.curves[side === 'left' ? 0 : 1].center[0]" @input="state.profile.curves[side === 'left' ? 0 : 1].center[0] = clamp(+$event.target.value || 0, 0, 100); markDirty()">
          </div>
          <div class="field">
            <label>中心死区 负半程 [3]</label>
            <input type="number" min="0" max="100" :value="state.profile.curves[side === 'left' ? 0 : 1].center[1]" @input="state.profile.curves[side === 'left' ? 0 : 1].center[1] = clamp(+$event.target.value || 0, 0, 100); markDirty()">
          </div>
          <div class="field">
            <label>外圈死区 [12]</label>
            <input type="number" min="0" max="100" :value="state.profile.curves[side === 'left' ? 0 : 1].outerDz" @input="state.profile.curves[side === 'left' ? 0 : 1].outerDz = clamp(+$event.target.value || 0, 0, 100); markDirty()">
          </div>
        </div>
      </div>

      <!-- 各曲线槽 -->
      <div v-for="(si, k) in (side === 'left' ? LEFT : RIGHT)" :key="si" class="card">
        <h2>{{ side === 'left' ? '左' : '右' }}摇杆 {{ NAME[k] }}</h2>
        <p class="desc">槽起点 [{{ [14, 62, 110, 158, 206, 254][si] }}];[2]=中心正 [3]=中心负 [4..11]=4 曲线点 [12][13]=上限(95,100) [14]=稳定系数</p>
        <div class="grid">
          <div class="field">
            <label>中心 正半程 [2]</label>
            <input type="number" min="0" max="100" :value="state.profile.curves[si].center[0]" @input="state.profile.curves[si].center[0] = clamp(+$event.target.value || 0, 0, 100); markDirty()">
          </div>
          <div class="field">
            <label>中心 负半程 [3]</label>
            <input type="number" min="0" max="100" :value="state.profile.curves[si].center[1]" @input="state.profile.curves[si].center[1] = clamp(+$event.target.value || 0, 0, 100); markDirty()">
          </div>
          <div class="field">
            <label>外圈死区 [12](100-补码)</label>
            <input type="number" min="0" max="100" :value="state.profile.curves[si].outerDz" @input="state.profile.curves[si].outerDz = clamp(+$event.target.value || 0, 0, 100); markDirty()">
          </div>
          <div class="field">
            <label>上限输出 [13]</label>
            <input type="number" min="0" max="100" :value="state.profile.curves[si].maxOut" @input="state.profile.curves[si].maxOut = clamp(+$event.target.value || 0, 0, 100); markDirty()">
          </div>
          <div class="field">
            <label>稳定系数 [14](-10..10)</label>
            <input type="number" min="-10" max="10" :value="state.profile.curves[si].stabilize" @input="state.profile.curves[si].stabilize = clamp(+$event.target.value || 0, -10, 10); markDirty()">
          </div>
        </div>
        <h3>响应曲线(4 点,拖动调整)</h3>
        <div style="display:flex;gap:16px;flex-wrap:wrap">
          <CurveEditor :points="state.profile.curves[si].points" @change="markDirty()" />
          <table class="tbl" style="max-width:200px;align-self:center">
            <thead><tr><th>点</th><th>x</th><th>y</th></tr></thead>
            <tbody>
              <tr v-for="j in 4" :key="j">
                <td>P{{ j - 1 }}</td>
                <td>{{ state.profile.curves[si].points[(j - 1) * 2] }}</td>
                <td>{{ state.profile.curves[si].points[(j - 1) * 2 + 1] }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <h3>扩展键映射(DirectionalTrigger)</h3>
        <div v-for="(g, gi) in state.profile.curves[si].ext" :key="gi" class="field" style="border:1px solid rgb(var(--border));border-radius:12px;padding:8px;margin-top:6px">
          <label>组 {{ gi }}:类型</label>
          <input type="number" min="0" max="255" style="width:60px" :value="g.type" @input="g.type = clamp(+$event.target.value || 0); markDirty()">
          <select :value="g.entry.type" @change="g.entry.type = Number($event.target.value); markDirty()">
            <option :value="0">单键/组合</option>
            <option :value="1">宏A(键盘)</option>
            <option :value="2">宏B(单值)</option>
          </select>
          <span v-for="(kk, i) in g.entry.keys" :key="i" class="chip">{{ vkName(kk) }}
            <button class="btn small" @click="g.entry.keys.splice(i, 1); markDirty()">×</button>
          </span>
          <select style="width:100px" @change="addExtKey(g, $event.target.value); $event.target.value=''">
            <option value="">+键</option>
            <option v-for="c in 25" :key="c - 1" :value="c - 1">按键{{ c - 1 }}</option>
            <option v-for="vk in [65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,48,49,50,51,52,53,54,55,56,57,162,160,164,91,13,32,8,27]" :key="'v' + vk" :value="vk">键盘 {{ vkName(vk) }}</option>
          </select>
        </div>
      </div>
    </div>
  </div>
</template>
