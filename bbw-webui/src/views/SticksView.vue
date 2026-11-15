<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { model, edit } from "../core/store.js";
import { applyJoystickCurve, sampleCurve, FULL_SCALE } from "../core/model.js";

const sel = ref("left");
const stick = computed(() => model.value.sticks[sel.value]);
const curve = computed(() => sampleCurve(stick.value, 40));

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------------- 试推：拖拽 or 跟手柄 ---------------- */
const pos = ref({ x: 0, y: 0 });
const svgEl = ref(null);
const padEl = ref(null);

function onDrag(e) {
  const el = padEl.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let dx = (e.clientX - cx) / (r.width / 2 - 14);
  let dy = (cy - e.clientY) / (r.height / 2 - 14);
  const len = Math.hypot(dx, dy);
  if (len > 1) { dx /= len; dy /= len; }
  pos.value = { x: dx, y: dy };
  el.setPointerCapture?.(e.pointerId);
}

/* 手柄实时输入 */
const pad = ref({ ok: false, x: 0, y: 0, id: "" });
const follow = ref(true);
let raf = 0;

/* 为什么读不到：给一个能直接截图上报的诊断 */
const diag = ref({ api: false, count: 0, ids: [], focused: false, iframe: false, secure: false, hid: [], t: "" });

async function refreshDiag() {
  const api = !!navigator.getGamepads;
  const list = api ? navigator.getGamepads() : [];
  const ids = [];
  for (let k = 0; k < list.length; k++) {
    const p = list[k];
    if (p && p.connected) ids.push(`${p.id} · ${p.mapping || "无映射"} · ${p.axes.length} 轴 / ${p.buttons.length} 键`);
  }
  let hid = [];
  try {
    const devs = navigator.hid ? await navigator.hid.getDevices() : [];
    hid = devs.map((d) => `${d.productName || "HID"} [${(d.collections || [])
      .map((c) => `${c.usagePage.toString(16)}:${c.usage.toString(16)}`).join(" ")}]`);
  } catch { /* 忽略 */ }
  diag.value = {
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

function pickPad() {
  const list = navigator.getGamepads ? navigator.getGamepads() : [];
  const pads = [];
  for (let k = 0; k < list.length; k++) {
    const p = list[k];
    if (p && p.connected) pads.push(p);
  }
  if (!pads.length) return null;
  // 优先 standard 映射（XInput 通道报的就是它），其次本机手柄 id，最后任意一台
  return pads.find((p) => p.mapping === "standard")
    || pads.find((p) => /413d|2104|bigbig|彩虹|won|xbox|xinput/i.test(p.id || ""))
    || pads[0];
}

let lastDiag = 0;
function poll() {
  const now = performance.now();
  if (now - lastDiag > 500) { lastDiag = now; refreshDiag(); }
  const p = pickPad();
  if (p) {
    const i = sel.value === "left" ? 0 : 2;
    let x = p.axes[i] ?? 0;
    let y = -(p.axes[i + 1] ?? 0);
    // XInput 斜推时模长可能略超 1，按单位圆收一下，避免圆点跑出边框
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    const prev = pad.value;
    // 只在变化时写，避免每帧重建对象触发整页重渲染
    if (!prev.ok || Math.abs(x - prev.x) > 0.0005 || Math.abs(y - prev.y) > 0.0005) {
      pad.value = { ok: true, x, y, id: p.id };
    }
  } else if (pad.value.ok) {
    pad.value = { ok: false, x: 0, y: 0, id: "" };
  }
  raf = requestAnimationFrame(poll);
}

/** 浏览器要收到一次手柄输入才会把设备暴露给页面，这里接住该事件立刻生效 */
function onGamepadConnected(e) {
  pad.value = { ok: true, x: 0, y: 0, id: e.gamepad?.id || "" };
}

/* HID 兜底：Chrome 在 Windows 上只认 XInput，DirectInput/HID 手柄拿不到 Gamepad API。
   这种情况下直接读输入接口的原始报文，先看得到数据，再按需解码。 */
const hidState = ref({ opened: false, hex: "", count: 0, err: "", name: "" });
let hidDev = null;
const hexOf = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join(" ");

/** 嵌入窗口里 Gamepad API 可能被权限策略挡掉，鼓励在独立标签页里用 */
function openInTab() {
  window.open(location.href, "_blank", "noopener");
}

function onHidReport(e) {
  const u8 = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
  hidState.value = { ...hidState.value, hex: `${e.reportId} | ${hexOf(u8)}`, count: hidState.value.count + 1 };
}

async function openHidInput() {
  try {
    if (!navigator.hid) throw new Error("此浏览器不支持 WebHID");
    const devs = await navigator.hid.requestDevice({
      filters: [{ vendorId: 0x413d, productId: 0x2104 }],
    });
    const dev = devs.find((d) =>
      (d.collections || []).some((c) => c.usagePage === 0x0001 && c.usage === 0x0005)) || devs[0];
    if (!dev) throw new Error("没有选中设备");
    await dev.open();
    dev.addEventListener("inputreport", onHidReport);
    hidDev = dev;
    hidState.value = { opened: true, hex: "", count: 0, err: "", name: dev.productName || "" };
  } catch (e) {
    hidState.value = { ...hidState.value, err: e.message };
  }
}

onMounted(() => {
  window.addEventListener("gamepadconnected", onGamepadConnected);
  raf = requestAnimationFrame(poll);
});
onBeforeUnmount(() => {
  window.removeEventListener("gamepadconnected", onGamepadConnected);
  cancelAnimationFrame(raf);
  if (hidDev) {
    hidDev.removeEventListener("inputreport", onHidReport);
    hidDev.close().catch(() => {});
    hidDev = null;
  }
});

const live = computed(() =>
  follow.value && pad.value.ok ? { x: pad.value.x, y: pad.value.y } : pos.value);

const out = computed(() =>
  applyJoystickCurve(
    { deadzoneCenter: stick.value.deadzone, points: stick.value.points },
    live.value.x * FULL_SCALE, live.value.y * FULL_SCALE,
  ));

const chain = computed(() => {
  const r = out.value.radius;
  const dz = stick.value.deadzone;
  if (r <= dz) return { r, r1: 0, y: 0 };
  return { r, r1: ((r - dz) / (100 - dz)) * 100, y: out.value.out };
});

/* ---------------- 曲线断点拖动 ---------------- */
const GEO = { x0: 28, y0: 20, w: 272, h: 144, vbW: 320, vbH: 200 };
const dragIdx = ref(-1);

function toValue(e) {
  const el = svgEl.value;
  const r = el.getBoundingClientRect();
  const k = GEO.vbW / r.width;
  const x = (e.clientX - r.left) * k;
  const y = (e.clientY - r.top) * k;
  return { in: ((x - GEO.x0) / GEO.w) * 100, out: ((GEO.y0 + GEO.h - y) / GEO.h) * 100 };
}

function startDrag(i, e) {
  dragIdx.value = i;
  e.preventDefault();
  e.currentTarget.setPointerCapture?.(e.pointerId);
}

function onPointMove(e) {
  if (dragIdx.value < 0) return;
  const v = toValue(e);
  const i = dragIdx.value;
  const pts = stick.value.points.map((p) => ({ ...p }));
  const minIn = i === 0 ? 1 : pts[i - 1].in + 1;
  const maxIn = i === pts.length - 1 ? 100 : pts[i + 1].in - 1;
  pts[i] = {
    in: clamp(Math.round(v.in), minIn, maxIn),
    out: clamp(Math.round(v.out), 0, 100),
  };
  edit({ sticks: { [sel.value]: { points: pts } } });
}

function endDrag() {
  dragIdx.value = -1;
}

/* ---------------- 数字输入 / 预设 ---------------- */
function setPoint(i, field, v) {
  const pts = stick.value.points.map((p, j) => (j === i ? { ...p, [field]: Number(v) } : { ...p }));
  edit({ sticks: { [sel.value]: { points: pts } } });
}
function setDeadzone(v) {
  edit({ sticks: { [sel.value]: { deadzone: Number(v) } } });
}
function presetLinear() {
  edit({
    sticks: {
      [sel.value]: {
        points: [0, 20, 40, 60, 80].map((v) => ({ in: v, out: v })),
      },
    },
  });
}
function presetClassic() {
  // 内圈缓、外圈陡：前段压低输出，便于微调
  edit({
    sticks: {
      [sel.value]: {
        points: [
          { in: 20, out: 12 }, { in: 40, out: 30 }, { in: 60, out: 52 },
          { in: 80, out: 78 }, { in: 100, out: 100 },
        ],
      },
    },
  });
}

const invert = computed(() => model.value.stickInvert);
const invKey = computed(() => (sel.value === "left" ? "left" : "right"));
function toggleInvert(axis) {
  const key = invKey.value + axis;
  edit({ stickInvert: { [key]: !invert.value[key] } });
}
</script>

<template>
  <div class="grid split">
    <!-- 曲线 -->
    <div class="card">
      <div class="card-head">
        <div class="grow">
          <h2>摇杆曲线</h2>
          <p>横轴为推杆距离（径向模长），纵轴为输出。拖圆点可直接改断点。</p>
        </div>
        <div class="seg">
          <button :class="{ on: sel === 'left' }" @click="sel = 'left'">左</button>
          <button :class="{ on: sel === 'right' }" @click="sel = 'right'">右</button>
        </div>
      </div>

      <svg ref="svgEl" viewBox="0 0 320 200" width="100%"
        style="display:block;touch-action:none;user-select:none"
        @pointermove="onPointMove" @pointerup="endDrag" @pointercancel="endDrag" @pointerleave="endDrag">
        <!-- 网格 -->
        <g stroke="rgb(var(--foreground)/.08)" stroke-width="1">
          <line v-for="i in 4" :key="'h' + i" x1="28" :y1="20 + i * 36" x2="300" :y2="20 + i * 36" />
          <line v-for="i in 4" :key="'v' + i" :x1="28 + i * 68" y1="20" :x2="28 + i * 68" y2="164" />
        </g>
        <!-- 死区带 -->
        <rect :x="28" y="20" :width="(stick.deadzone / 100) * 272" height="144"
          fill="rgb(var(--warning)/.10)" />
        <line :x1="28 + (stick.deadzone / 100) * 272" y1="20" :x2="28 + (stick.deadzone / 100) * 272" y2="164"
          stroke="rgb(var(--warning)/.45)" stroke-dasharray="3 3" />
        <!-- 对角参考 -->
        <line x1="28" y1="164" x2="300" y2="20" stroke="rgb(var(--foreground)/.14)" stroke-dasharray="4 4" />
        <!-- 曲线 -->
        <polyline fill="none" stroke="rgb(var(--accent))" stroke-width="2.4" stroke-linejoin="round"
          :points="curve.map((p) => `${28 + (p.x / 100) * 272},${164 - (Math.min(100, p.y) / 100) * 144}`).join(' ')" />
        <!-- 断点 -->
        <g v-for="(p, i) in stick.points" :key="i">
          <circle :cx="28 + (p.in / 100) * 272" :cy="164 - (Math.min(100, p.out) / 100) * 144"
            :r="dragIdx === i ? 6 : 4.4"
            fill="rgb(var(--card))" stroke="rgb(var(--accent))"
            :stroke-width="dragIdx === i ? 2.6 : 2" />
          <circle :cx="28 + (p.in / 100) * 272" :cy="164 - (Math.min(100, p.out) / 100) * 144" r="13"
            fill="transparent" style="cursor:grab" @pointerdown.stop="startDrag(i, $event)" />
        </g>
        <!-- 轴标 -->
        <text x="14" y="24" fill="rgb(var(--muted-foreground))" font-size="9">100</text>
        <text x="14" y="168" fill="rgb(var(--muted-foreground))" font-size="9">0</text>
        <text x="272" y="178" fill="rgb(var(--muted-foreground))" font-size="9">100</text>
      </svg>

      <div class="row between" style="margin-top:10px">
        <div class="hint">死区 {{ stick.deadzone }}%</div>
        <div class="row">
          <button class="btn sm ghost" @click="presetLinear">线性</button>
          <button class="btn sm ghost" @click="presetClassic">内缓外陡</button>
        </div>
      </div>
      <input class="range" type="range" min="0" max="40" step="1" :value="stick.deadzone"
        :style="{ '--fill': (stick.deadzone / 40) * 100 + '%' }" @input="setDeadzone($event.target.value)" />

      <table class="tbl" style="margin-top:12px">
        <thead>
          <tr><th>断点</th><th>输入 %</th><th>输出 %</th><th>增益</th></tr>
        </thead>
        <tbody>
          <tr v-for="(p, i) in stick.points" :key="i">
            <td class="hint">#{{ i + 1 }}</td>
            <td><input class="input num" type="number" min="0" max="100" :value="p.in"
              @change="setPoint(i, 'in', $event.target.value)" /></td>
            <td><input class="input num" type="number" min="0" max="100" :value="p.out"
              @change="setPoint(i, 'out', $event.target.value)" /></td>
            <td class="hint num">{{ p.in ? (p.out / p.in).toFixed(2) : '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 试推 -->
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="card">
        <div class="card-head">
          <div class="grow">
            <h2>试推</h2>
            <p>拖动圆点，或直接推手柄。</p>
          </div>
          <label class="check" :title="pad.ok ? pad.id : '先推一下手柄摇杆或按任意键激活'"
            :style="pad.ok ? '' : 'opacity:.75'">
            <input type="checkbox" v-model="follow" />
            <span>读取手柄</span>
          </label>
        </div>

        <svg ref="padEl" viewBox="0 0 200 200" width="100%"
          style="max-width:240px;margin:0 auto;display:block;touch-action:none"
          @pointerdown="onDrag" @pointermove="(e) => e.buttons && onDrag(e)">
          <circle cx="100" cy="100" r="88" fill="rgb(var(--foreground)/.035)" stroke="rgb(var(--border))" />
          <circle cx="100" cy="100" :r="(stick.deadzone / 100) * 88" fill="none"
            stroke="rgb(var(--warning)/.5)" stroke-dasharray="3 3" />
          <line x1="12" y1="100" x2="188" y2="100" stroke="rgb(var(--foreground)/.08)" />
          <line x1="100" y1="12" x2="100" y2="188" stroke="rgb(var(--foreground)/.08)" />
          <!-- 输入点 -->
          <line x1="100" y1="100" :x2="100 + live.x * 88" :y2="100 - live.y * 88"
            stroke="rgb(var(--foreground)/.25)" stroke-width="1.5" />
          <circle :cx="100 + live.x * 88" :cy="100 - live.y * 88" r="7" fill="rgb(var(--foreground)/.25)" />
          <!-- 输出点 -->
          <circle :cx="100 + (out.x / FULL_SCALE) * 88" :cy="100 - (out.y / FULL_SCALE) * 88" r="9"
            fill="rgb(var(--accent)/.85)" stroke="rgb(var(--card))" stroke-width="2" />
        </svg>

        <div v-if="follow && !pad.ok" style="margin-top:10px;text-align:center">
          <div class="hint" style="line-height:1.7">
            未检测到手柄输入。浏览器要先收到一次手柄动作才会暴露设备：<br />按一下手柄任意键，或推动摇杆。
          </div>
          <div v-if="diag.iframe" class="hint" style="margin-top:8px;line-height:1.7;color:rgb(var(--warning))">
            当前页面运行在嵌入窗口里，手柄接口可能被禁用。用下面的按钮在独立标签页打开再试。
          </div>
          <button v-if="diag.iframe" class="btn sm" style="margin-top:8px" @click="openInTab">在新标签页打开</button>
          <div class="hint mono" style="margin-top:8px;line-height:1.75">
            Gamepad API {{ diag.api ? "可用" : "不可用" }} · 设备 {{ diag.count }} 台 ·
            焦点 {{ diag.focused ? "有" : "无" }}{{ diag.iframe ? " · 嵌入窗口" : "" }}{{ diag.secure ? "" : " · 非安全上下文" }}
            <template v-if="diag.ids.length"><br />{{ diag.ids.join("；") }}</template>
            <template v-if="diag.hid.length"><br />HID：{{ diag.hid.join("；") }}</template>
          </div>
          <button class="btn sm" style="margin-top:8px" @click="refreshDiag">重新检测</button>

          <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgb(var(--border))">
            <button class="btn sm" :disabled="hidState.opened" @click="openHidInput">
              {{ hidState.opened ? "输入接口已打开" : "直接读 HID 输入" }}
            </button>
            <div v-if="hidState.err" class="hint" style="margin-top:6px;color:rgb(var(--destructive))">{{ hidState.err }}</div>
            <div v-if="hidState.hex" class="hint mono" style="margin-top:6px;word-break:break-all;text-align:left">{{ hidState.hex }}</div>
            <div v-if="hidState.opened" class="hint" style="margin-top:6px">
              已收到 {{ hidState.count }} 帧。推动摇杆后的那行十六进制发我，用它定字段。
            </div>
          </div>
        </div>

        <div class="grid c2" style="gap:10px;margin-top:14px">
          <div class="stat" style="padding:10px 12px">
            <div class="k">输入</div>
            <div class="v num" style="font-size:16px">{{ chain.r.toFixed(1) }}<span class="u">%</span></div>
          </div>
          <div class="stat" style="padding:10px 12px">
            <div class="k">输出</div>
            <div class="v num" style="font-size:16px">{{ chain.y.toFixed(1) }}<span class="u">%</span></div>
          </div>
        </div>
        <div class="hint tech mono" style="margin-top:10px;line-height:1.8">
          r = {{ chain.r.toFixed(1) }}%<br />
          r ≤ {{ stick.deadzone }}% ? → {{ chain.r <= stick.deadzone ? '归零' : '否' }}<br />
          r1 = (r − {{ stick.deadzone }}) / (100 − {{ stick.deadzone }}) × 100 = {{ chain.r1.toFixed(1) }}%<br />
          out = curve(r1) = {{ chain.y.toFixed(1) }}%
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="grow"><h2>轴反转</h2><p>物理摇杆轴，与体感的轴向反转互不影响。</p></div></div>
        <div class="field">
          <div class="grow"><div class="label">{{ sel === 'left' ? '左' : '右' }}摇杆 X 轴</div></div>
          <button class="switch" :class="{ on: invert[invKey + 'X'] }" @click="toggleInvert('X')"></button>
        </div>
        <div class="field">
          <div class="grow"><div class="label">{{ sel === 'left' ? '左' : '右' }}摇杆 Y 轴</div></div>
          <button class="switch" :class="{ on: invert[invKey + 'Y'] }" @click="toggleInvert('Y')"></button>
        </div>
        <div class="hint tech" style="margin-top:8px">写入 [13]，真机实测位域：左 X bit0、左 Y bit1、右 X bit4、右 Y bit5。</div>
      </div>
    </div>
  </div>
</template>
