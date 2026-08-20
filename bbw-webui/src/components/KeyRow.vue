<script setup>
import { ref, computed } from "vue";
import { keyName, vkName } from "../lib/names.js";
import { markDirty } from "../lib/store.js";

const props = defineProps({
  entry: { type: Object, required: true }, // 可编辑键条目(响应式)
  name: { type: String, default: "" },     // 展示名(学习结果优先)
});

const recording = ref(false);
const isCombo = computed(() => props.entry.type === 0);
const keyLabel = computed(() => (k) => (isCombo.value ? keyName(k) : vkName(k)));

function addKey(vk) {
  if (vk === undefined || vk === null || vk === "") return;
  const n = Number(vk);
  if (n === -1 || props.entry.keys.includes(n)) return;
  props.entry.keys.push(n);
  markDirty();
}
function removeKey(i) {
  props.entry.keys.splice(i, 1);
  markDirty();
}
function onKeydown(e) {
  if (!recording.value) return;
  e.preventDefault();
  const vk = e.keyCode; // Windows VK
  recording.value = false;
  document.removeEventListener("keydown", onKeydown);
  addKey(vk);
}
function startRecord() {
  if (recording.value) return;
  recording.value = true;
  document.addEventListener("keydown", onKeydown);
  setTimeout(() => { if (recording.value) { recording.value = false; document.removeEventListener("keydown", onKeydown); } }, 8000);
}
</script>

<template>
  <tr>
    <td><b>{{ name }}</b> <span class="hint">code={{ entry.code }}</span></td>
    <td>
      <select :value="entry.type" @change="entry.type = Number($event.target.value); markDirty()">
        <option :value="0">单键/组合</option>
        <option :value="1">宏A(键盘)</option>
        <option :value="2">宏B(单值)</option>
      </select>
    </td>
    <td><input type="checkbox" v-model="entry.enabled" @change="markDirty()"></td>
    <td>
      <span v-for="(k, i) in entry.keys" :key="i" class="chip">
        {{ keyLabel(k) }}
        <button class="btn small" @click="removeKey(i)">×</button>
      </span>
      <span v-if="!entry.keys.length" class="hint">(空)</span>
      <button class="btn small" :class="{ primary: recording }" @click="startRecord">{{ recording ? "按下要绑定的键…" : "录制" }}</button>
      <select v-if="isCombo" style="width:110px" @change="addKey($event.target.value); $event.target.value=''">
        <option value="">+按键</option>
        <option v-for="c in 25" :key="c - 1" :value="c - 1">{{ keyName(c - 1) }}</option>
        <option value="-1">(无)</option>
      </select>
    </td>
  </tr>
</template>
