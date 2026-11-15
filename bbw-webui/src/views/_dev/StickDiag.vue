<script setup>
/**
 * 试推读不到手柄时的诊断面板。
 * 只在 `npm run dev` 下被 SticksView 动态引入，`npm run build` 时整块代码
 * 连同文案一起被裁掉，发布版不会出现这些内容。
 */
import { onBeforeUnmount, onMounted, ref } from "vue";

const empty = { api: false, count: 0, ids: [], focused: false, iframe: false, secure: false, hid: [], t: "" };
const d = ref({ ...empty });
const copied = ref(false);
let timer = 0;

async function refresh() {
  const api = !!navigator.getGamepads;
  const list = api ? navigator.getGamepads() : [];
  const ids = [];
  for (let k = 0; k < list.length; k++) {
    const p = list[k];
    if (p && p.connected) {
      ids.push(`${p.id} · ${p.mapping || "无映射"} · ${p.axes.length} 轴 / ${p.buttons.length} 键`);
    }
  }
  let hid = [];
  try {
    const devs = navigator.hid ? await navigator.hid.getDevices() : [];
    hid = devs.map((x) => `${x.productName || "HID"} [${(x.collections || [])
      .map((c) => `${c.usagePage.toString(16)}:${c.usage.toString(16)}`).join(" ")}]`);
  } catch { /* 未授权时忽略 */ }
  d.value = {
    api,
    count: ids.length,
    ids,
    focused: document.hasFocus(),
    iframe: window.top !== window,
    secure: window.isSecureContext !== false,
    hid,
    t: new Date().toLocaleTimeString(),
  };
}

function copy() {
  const x = d.value;
  const text = [
    `Gamepad API ${x.api ? "可用" : "不可用"}`,
    `设备 ${x.count} 台`,
    `焦点 ${x.focused ? "有" : "无"}`,
    x.iframe ? "嵌入窗口" : "顶层页面",
    x.secure ? "安全上下文" : "非安全上下文",
    ...x.ids,
    ...x.hid.map((h) => `HID ${h}`),
  ].join(" · ");
  navigator.clipboard?.writeText(text).then(() => {
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1600);
  }).catch(() => {});
}

onMounted(() => {
  refresh();
  timer = setInterval(refresh, 1000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <div class="hint mono" style="margin-top:8px;line-height:1.75">
    Gamepad API {{ d.api ? "可用" : "不可用" }} · 设备 {{ d.count }} 台 ·
    焦点 {{ d.focused ? "有" : "无" }}{{ d.iframe ? " · 嵌入窗口" : "" }}{{ d.secure ? "" : " · 非安全上下文" }}
    <template v-if="d.ids.length"><br />{{ d.ids.join("；") }}</template>
    <template v-if="d.hid.length"><br />HID：{{ d.hid.join("；") }}</template>
  </div>
  <button class="btn sm" style="margin-top:8px" @click="refresh">重新检测</button>
  <button class="btn sm" style="margin-left:8px" @click="copy">{{ copied ? "已复制" : "复制诊断" }}</button>
</template>
