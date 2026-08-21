<script setup>
// 摇杆曲线编辑器:平面直角坐标系(0..100 × 0..100),4 个可拖动点
// points = 8 字节数组:[x0,y0, x1,y1, x2,y2, x3,y3](槽内 [4..11])
import { ref, computed, onBeforeUnmount } from "vue";

const props = defineProps({
  points: { type: Array, required: true }, // 8 元素(响应式)
});
const emit = defineEmits(["change"]);

const svgRef = ref(null);
const dragging = ref(-1);
const SIZE = 100;
const R = 3.4;

const pts = computed(() => {
  const out = [];
  for (let i = 0; i < 4; i++) out.push({ x: props.points[i * 2] ?? 0, y: props.points[i * 2 + 1] ?? 0 });
  return out;
});
const disp = (pt) => ({ x: pt.x, y: SIZE - pt.y }); // SVG y 向下,数据 y 向上

function toSvg(e) {
  const rect = svgRef.value.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * SIZE;
  const y = ((e.clientY - rect.top) / rect.height) * SIZE;
  return { x: Math.round(Math.max(0, Math.min(SIZE, x))), y: Math.round(Math.max(0, Math.min(SIZE, y))) };
}
function onDown(i, e) {
  dragging.value = i;
  e.preventDefault();
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}
function onMove(e) {
  if (dragging.value < 0) return;
  const i = dragging.value;
  const { x, y } = toSvg(e);
  const prevX = i > 0 ? pts.value[i - 1].x : 0;
  const nextX = i < 3 ? pts.value[i + 1].x : SIZE;
  props.points[i * 2] = Math.max(prevX, Math.min(nextX, x)); // x 非降序
  props.points[i * 2 + 1] = SIZE - y;
  emit("change");
}
function onUp() {
  dragging.value = -1;
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
}
onBeforeUnmount(onUp);

const ptsPath = computed(() => pts.value.map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.x} ${SIZE - pt.y}`).join(" "));
</script>

<template>
  <div>
    <svg ref="svgRef" :viewBox="`0 0 ${SIZE} ${SIZE}`" preserveAspectRatio="none"
      style="width:100%;max-width:340px;aspect-ratio:1/1;touch-action:none;user-select:none;cursor:crosshair">
      <g v-for="g in [0, 20, 40, 60, 80, 100]" :key="g">
        <line :x1="g" y1="0" :x2="g" y2="100" stroke="rgb(var(--border))" stroke-width="0.4" />
        <line x1="0" :y1="g" x2="100" :y2="g" stroke="rgb(var(--border))" stroke-width="0.4" />
      </g>
      <line x1="0" y1="0" x2="100" y2="0" stroke="rgb(var(--muted-foreground))" stroke-width="0.8" />
      <line x1="0" y1="0" x2="0" y2="100" stroke="rgb(var(--muted-foreground))" stroke-width="0.8" />
      <line x1="0" y1="0" x2="100" y2="100" stroke="rgb(var(--muted-foreground))" stroke-width="0.3" stroke-dasharray="3 3" />
      <path :d="ptsPath" fill="none" stroke="rgb(var(--accent))" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round" />
      <circle v-for="(pt, i) in pts" :key="i" :cx="disp(pt).x" :cy="disp(pt).y" :r="R"
        fill="rgb(var(--primary))" stroke="#fff" stroke-width="1" style="cursor:grab"
        @pointerdown="onDown(i, $event)" />
      <text v-for="(pt, i) in pts" :key="'t' + i" :x="disp(pt).x" :y="Math.max(5, disp(pt).y - 5)"
        font-size="4.6" fill="rgb(var(--muted-foreground))" text-anchor="middle">{{ pt.x }},{{ pt.y }}</text>
    </svg>
    <p class="hint" style="margin-top:4px">拖动 4 个点,或在下方表格输入精确值(x/y 0..100,x 保持非降序)</p>
  </div>
</template>
