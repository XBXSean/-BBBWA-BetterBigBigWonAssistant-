<script setup>
import { computed } from "vue";
import { model, edit } from "../core/store.js";

function setRange(side, field, v) {
  edit({ trigger: { [side]: { [field]: Number(v) } } });
}
function toggleHire(side) {
  const cur = model.value.hire[side];
  edit({ hire: { [side]: !cur } });
}

const rows = computed(() => [
  { id: "left", label: "左扳机", data: model.value.trigger.left, hire: model.value.hire.left, off: [5, 6] },
  { id: "right", label: "右扳机", data: model.value.trigger.right, hire: model.value.hire.right, off: [7, 8] },
]);

/** 输出曲线示意：模拟模式线性，微动模式二值 */
function outAt(d, hire, x) {
  const { low, high } = d;
  if (high <= low) return 0;
  const raw = (x - low) / (high - low);
  if (hire) return x >= low ? 255 : 0;
  return Math.max(0, Math.min(1, raw)) * 255;
}
</script>

<template>
  <div class="grid c2">
    <div v-for="r in rows" :key="r.id" class="card">
      <div class="card-head">
        <div class="grow">
          <h2>{{ r.label }}</h2>
          <p>行程 {{ r.data.low }}–{{ r.data.high }}%（[{{ r.off[0] }}] / [{{ r.off[1] }}]）</p>
        </div>
        <span class="badge" :class="r.hire ? 'accent' : ''">{{ r.hire ? '微动' : '模拟' }}</span>
      </div>

      <div class="field">
        <div class="grow">
          <div class="label">微动模式</div>
          <div class="desc">物理切换。开启后按过下限即满值，不存在中间行程</div>
        </div>
        <button class="switch" :class="{ on: r.hire }" @click="toggleHire(r.id)"></button>
      </div>

      <div class="field">
        <div class="grow"><div class="label">下限</div><div class="desc">按下多少开始输出</div></div>
        <input class="input num" type="number" min="0" max="99" :value="r.data.low"
          @change="setRange(r.id, 'low', $event.target.value)" />
      </div>
      <div class="field">
        <div class="grow"><div class="label">上限</div><div class="desc">到多少即满值</div></div>
        <input class="input num" type="number" min="1" max="100" :value="r.data.high"
          @change="setRange(r.id, 'high', $event.target.value)" />
      </div>

      <!-- 输出曲线：横轴物理行程，纵轴输出 -->
      <svg viewBox="0 0 300 124" width="100%" style="margin-top:8px">
        <g stroke="rgb(var(--foreground)/.08)">
          <line x1="10" y1="100" x2="290" y2="100" />
          <line x1="10" y1="12" x2="290" y2="12" />
        </g>
        <!-- 有效行程带 -->
        <rect :x="10 + (r.data.low / 100) * 280" y="12"
          :width="Math.max(0, ((r.data.high - r.data.low) / 100) * 280)" height="88"
          fill="rgb(var(--accent)/.09)" />
        <!-- 输出曲线 -->
        <polyline fill="none" stroke="rgb(var(--accent))" stroke-width="2.2" stroke-linejoin="round"
          :points="Array.from({ length: 51 }, (_, i) => {
            const x = i * 2;
            const y = 100 - (outAt(r.data, r.hire, x) / 255) * 88;
            return (10 + (x / 100) * 280).toFixed(1) + ',' + y.toFixed(1);
          }).join(' ')" />
        <!-- 上下限刻度 -->
        <line :x1="10 + (r.data.low / 100) * 280" y1="100" :x2="10 + (r.data.low / 100) * 280" y2="106"
          stroke="rgb(var(--warning)/.8)" stroke-width="1.5" />
        <line :x1="10 + (r.data.high / 100) * 280" y1="100" :x2="10 + (r.data.high / 100) * 280" y2="106"
          stroke="rgb(var(--warning)/.8)" stroke-width="1.5" />
        <text x="4" y="16" font-size="8.5" fill="rgb(var(--muted-foreground))" text-anchor="start">255</text>
        <text x="4" y="103" font-size="8.5" fill="rgb(var(--muted-foreground))" text-anchor="start">0</text>
        <text :x="10 + (r.data.low / 100) * 280" y="118" font-size="8.5"
          fill="rgb(var(--muted-foreground))" text-anchor="middle">{{ r.data.low }}</text>
        <text :x="10 + (r.data.high / 100) * 280" y="118" font-size="8.5"
          fill="rgb(var(--muted-foreground))" text-anchor="middle">{{ r.data.high }}</text>
      </svg>
      <div class="hint">横轴物理行程 0–100%，纵轴输出 0–255。</div>
    </div>
  </div>

  <div class="card tech">
    <div class="card-head"><div class="grow"><h2>换算</h2><p>真机输出与配置字节的对应关系（9/9 组实测吻合）。</p></div></div>
    <div class="hint mono" style="line-height:2">
      模拟：out = clamp((R − low) / (high − low) × 255)<br />
      微动：out = R ≥ low ? 255 : 0<br />
      字节：[5] = 左下限 · [6] = 100 − 左上限 · [7] = 右下限 · [8] = 100 − 右上限<br />
      微动位：[4] bit0 = 左 · bit1 = 右
    </div>
  </div>
</template>
