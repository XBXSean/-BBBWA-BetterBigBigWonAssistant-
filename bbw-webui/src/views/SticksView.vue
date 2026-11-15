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

function pickPad() {
  const list = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of list) {
    if (!p || !p.connected) continue;
    if (/413d|2104|bigbig|彩虹|won/i.test(p.id || "") || p.mapping === "standard") return p;
  }
  return null;
}

function poll() {
  const p = pickPad();
  if (p) {
    const i = sel.value === "left" ? 0 : 2;
    const x = p.axes[i] ?? 0;
    const y = -(p.axes[i + 1] ?? 0);
    pad.value = { ok: true, x, y, id: p.id };
  } else {
    pad.value = { ok: false, x: 0, y: 0, id: "" };
  }
  raf = requestAnimationFrame(poll);
}

onMounted(() => { raf = requestAnimationFrame(poll); });
onBeforeUnmount(() => cancelAnimationFrame(raf));

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
          <label class="check" :title="pad.ok ? pad.id : '未检测到手柄输入接口'"
            :style="pad.ok ? '' : 'opacity:.55'">
            <input type="checkbox" v-model="follow" :disabled="!pad.ok" />
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
