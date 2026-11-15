<script setup>
import { computed, ref } from "vue";
import { model, edit } from "../core/store.js";
import { keyName, slotToCode, vkName, hidToVkMod, hidToVkKey } from "../lib/names.js";
import { keyCodeToBitmap, bitmapToSlot, encodeKeyEntry } from "../../../bbw-protocol/src/keymap.js";

const PHYSICAL = Array.from({ length: 25 }, (_, code) => code)
  .map((code) => ({ code, slot: bitmapToSlot(keyCodeToBitmap(code)) }))
  .filter((x) => x.slot >= 0);

const VK_LIST = [
  ...Array.from({ length: 26 }, (_, i) => 65 + i),
  32, 13, 27, 9, 8, 46, 45, 36, 35, 33, 34, 37, 38, 39, 40,
  ...Array.from({ length: 12 }, (_, i) => 112 + i),
  160, 161, 162, 163, 164, 165, 91,
];

const selected = ref(PHYSICAL[0].code);
const sel = computed(() => PHYSICAL.find((p) => p.code === selected.value));
const entry = computed(() => model.value.keySlots[sel.value.slot]);

/** 设备键类型 + 编码 → 可读描述 */
function describe(type, bytes) {
  if (type === 1) {
    const codes = bytes.filter((b) => b !== 0xff && b !== 0).map((b) => slotToCode(b));
    return codes.length ? codes.map(keyName).join(" + ") : "组合（空）";
  }
  if (type === 2) {
    const vks = bytes[0] ? [hidToVkMod(bytes[0]), hidToVkKey(bytes[1]), hidToVkKey(bytes[2])]
      : [hidToVkKey(bytes[1]), hidToVkKey(bytes[2])];
    return vks.filter(Boolean).map(vkName).join(" + ");
  }
  if (type === 3) return bytes[0] ? `宏B ${bytes[0]}` : "宏B（空）";
  return "自映射";
}

const typeName = (t) => (t === 1 ? "组合" : t === 2 ? "宏 A（键盘）" : t === 3 ? "宏 B" : "自映射");

const rows = computed(() => PHYSICAL.map((p) => {
  const e = model.value.keySlots[p.slot];
  return {
    ...p,
    type: e.type,
    text: describe(e.type, e.bytes),
    enabled: !!(model.value.keyEnable & (1 << p.slot)),
  };
}));

const target = ref("");
const mode = ref(0); // 0 组合(物理键) 1 宏A(键盘键)

function apply(keys) {
  const enc = encodeKeyEntry({ code: selected.value, type: mode.value === 1 ? 1 : 0, keys });
  edit({
    keySlot: { index: sel.value.slot, type: enc.type, bytes: enc.bytes },
    keyEnable: { slot: sel.value.slot, on: true },
  });
}
function setCombo(code) {
  mode.value = 0;
  apply([Number(code)]);
}
function setMacro(vk) {
  mode.value = 1;
  apply([Number(vk)]);
}
function clear() {
  edit({
    keySlot: { index: sel.value.slot, type: 0, bytes: [0, 0, 0] },
    keyEnable: { slot: sel.value.slot, on: false },
  });
}
function toggleEnable() {
  const on = !(model.value.keyEnable & (1 << sel.value.slot));
  edit({ keyEnable: { slot: sel.value.slot, on } });
}
</script>

<template>
  <div class="grid split">
    <div class="card">
      <div class="card-head">
        <div class="grow">
          <h2>按键</h2>
          <p>物理按键的当前输出。槽位 {{ sel.slot }}，键码 {{ sel.code }}。</p>
        </div>
      </div>
      <div style="max-height:min(62vh,560px);overflow-y:auto">
      <table class="tbl">
        <thead style="position:sticky;top:0;background:rgb(var(--card));z-index:1"><tr><th>按键</th><th>输出</th><th>类型</th><th></th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.code" @click="selected = r.code" style="cursor:pointer"
            :style="r.code === selected ? 'background:rgb(var(--accent)/.10)' : ''">
            <td style="font-weight:600">{{ keyName(r.code) }}</td>
            <td :class="r.type ? '' : 'hint'">{{ r.text }}</td>
            <td class="hint">{{ typeName(r.type) }}</td>
            <td><span v-if="r.enabled" class="dot ok"></span></td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>

    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="card">
        <div class="card-head">
          <div class="grow">
            <h2>{{ keyName(sel.code) }}</h2>
            <p>{{ describe(entry.type, entry.bytes) }}</p>
          </div>
          <span class="badge" :class="entry.type ? 'accent' : ''">{{ typeName(entry.type) }}</span>
        </div>

        <div class="field">
          <div class="grow">
            <div class="label">映射为手柄按键</div>
            <div class="desc">写入组合编码，目标为该键的槽位索引</div>
          </div>
          <select class="select" :value="target" @change="target = $event.target.value; setCombo($event.target.value)">
            <option value="">选择</option>
            <option v-for="p in PHYSICAL" :key="p.code" :value="p.code">{{ keyName(p.code) }}</option>
          </select>
        </div>

        <div class="field">
          <div class="grow">
            <div class="label">映射为键盘按键</div>
            <div class="desc">宏 A：按 HID 序列下发，单键</div>
          </div>
          <select class="select" :value="target" @change="target = $event.target.value; setMacro($event.target.value)">
            <option value="">选择</option>
            <option v-for="vk in VK_LIST" :key="vk" :value="vk">{{ vkName(vk) }}</option>
          </select>
        </div>

        <div class="field">
          <div class="grow">
            <div class="label">使能位</div>
            <div class="desc">[344..347] 位图 bit{{ sel.slot }}</div>
          </div>
          <button class="switch" :class="{ on: model.keyEnable & (1 << sel.slot) }" @click="toggleEnable"></button>
        </div>

        <div class="row between" style="margin-top:12px">
          <div class="hint mono tech">type={{ entry.type }} bytes={{ entry.bytes.join(' ') }}</div>
          <button class="btn sm danger" @click="clear">清除映射</button>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="grow"><h2>说明</h2></div></div>
        <ul class="hint" style="margin:0;padding-left:16px;line-height:1.9">
          <li>键码 0..3 为 M1..M4，真机未学习到对应物理键</li>
          <li>组合编码存的是目标键的槽位索引，0xFF 表示空位</li>
          <li>宏 A 存 HID 键码；首字节非 0 时视为修饰键</li>
          <li>使能位不决定宏是否生效，宏绑定本身独立</li>
        </ul>
      </div>
    </div>
  </div>
</template>
