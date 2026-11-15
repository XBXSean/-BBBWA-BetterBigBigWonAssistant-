<script setup>
import { computed } from "vue";
import { model, edit } from "../core/store.js";
import { SIM_KEYS, simKeyName, MOTION_MODE, RESPOND } from "../core/model.js";

const m = computed(() => model.value.motion);
const selectedKey = computed(() => (m.value.simKeyIds.length ? m.value.simKeyIds[0] : ""));

function setMode(v) { edit({ motion: { mode: Number(v) } }); }
function setRespond(v) { edit({ motion: { respond: Number(v) } }); }
function setKey(v) { edit({ motion: { simKeyIds: v === "" ? [] : [Number(v)] } }); }
function toggleAxis(axis) {
  edit({ motion: { [axis === "x" ? "invertX" : "invertY"]: !m.value[axis === "x" ? "invertX" : "invertY"] } });
}
</script>

<template>
  <div class="grid split">
    <div class="card">
      <div class="card-head">
        <div class="grow">
          <h2>体感映射</h2>
          <p>倾角驱动，输出叠加在{{ m.mode === 2 ? '右摇杆' : '左摇杆' }}上。</p>
        </div>
        <span class="badge" :class="m.mode ? 'accent' : ''">{{ m.mode ? MOTION_MODE[m.mode] : '关闭' }}</span>
      </div>

      <div class="field">
        <div class="grow">
          <div class="label">模拟摇杆</div>
          <div class="desc">[304] 低半字节。关闭时摇杆的体感分量归零</div>
        </div>
        <select class="select" :value="m.mode" @change="setMode($event.target.value)">
          <option v-for="(label, v) in MOTION_MODE" :key="v" :value="Number(v)">{{ label }}</option>
        </select>
      </div>

      <div class="field">
        <div class="grow">
          <div class="label">响应方式</div>
          <div class="desc">[304] 高半字节。按下触发时，按住指定键才有输出</div>
        </div>
        <div class="seg">
          <button :class="{ on: m.respond === 0 }" @click="setRespond(0)">{{ RESPOND[0] }}</button>
          <button :class="{ on: m.respond === 1 }" @click="setRespond(1)">{{ RESPOND[1] }}</button>
        </div>
      </div>

      <div class="field" :style="{ opacity: m.respond === 1 ? 1 : 0.45 }">
        <div class="grow">
          <div class="label">触发按键</div>
          <div class="desc">[305..308] 位图。枚举 9 = A 键（真机已验证）</div>
        </div>
        <select class="select" :value="selectedKey" :disabled="m.respond !== 1" @change="setKey($event.target.value)">
          <option value="">不指定</option>
          <option v-for="k in SIM_KEYS" :key="k.id" :value="k.id">
            {{ simKeyName(k.id) }}（枚举 {{ k.id }}）
          </option>
        </select>
      </div>

      <div class="field">
        <div class="grow">
          <div class="label">水平反转（X）</div>
          <div class="desc">[311] {{ m.mode === 2 ? 'bit3' : 'bit1' }}。只反转体感分量，不动物理摇杆</div>
        </div>
        <button class="switch" :class="{ on: m.invertX }" @click="toggleAxis('x')"></button>
      </div>
      <div class="field">
        <div class="grow">
          <div class="label">垂直反转（Y）</div>
          <div class="desc">[311] {{ m.mode === 2 ? 'bit4' : 'bit2' }}</div>
        </div>
        <button class="switch" :class="{ on: m.invertY }" @click="toggleAxis('y')"></button>
      </div>
    </div>

    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="card tech">
        <div class="card-head"><div class="grow"><h2>字节</h2></div></div>
        <table class="tbl">
          <tbody>
            <tr><td class="hint">[304] 模式</td><td class="mono">0x{{ m.byte304.toString(16).toUpperCase().padStart(2, '0') }}</td></tr>
            <tr><td class="hint">[305..308] 位图</td><td class="mono">0x{{ m.simBits.toString(16).toUpperCase().padStart(8, '0') }}</td></tr>
            <tr><td class="hint">[311] 反转位</td><td class="mono">0x{{ m.byte311.toString(16).toUpperCase().padStart(2, '0') }}</td></tr>
          </tbody>
        </table>
        <div class="hint" style="margin-top:10px">
          改 [304] 会让真机重新枚举 USB，写入后通常需要重新连接。
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="grow"><h2>已知限制</h2></div></div>
        <ul class="hint" style="margin:0;padding-left:16px;line-height:1.9">
          <li>驱动方式是重力/倾角，不是角速度：侧倾→X，俯仰→Y</li>
          <li>[312]/[315]/[316]/[318] 四个参数（灵敏度、水平垂直比、响应曲线、死区补偿）写入会保存，本机型固件不读取</li>
          <li>输出叠加在摇杆自身值上，不会覆盖物理摇杆的位置</li>
          <li>「模拟右摇杆」按反编译的枚举加入（低半字节 2），真机尚未验证；切到它之后轴向反转用 bit3/bit4</li>
        </ul>
      </div>
    </div>
  </div>
</template>
