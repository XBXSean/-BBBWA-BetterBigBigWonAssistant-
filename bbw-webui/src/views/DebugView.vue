<script setup>
import { computed, ref } from "vue";
import { state, model, diff, mlog, revert } from "../core/store.js";
import { mockReset } from "../core/mock-hid.js";

const tab = ref("hex");
const changed = computed(() => new Set(diff.value.map((d) => d.off)));

const blocks = computed(() => {
  const p = state.draft;
  if (!p) return [];
  const out = [];
  for (let i = 0; i < p.length; i += 16) out.push(Array.from(p.subarray(i, i + 16)).map((v, j) => ({ off: i + j, v })));
  return out;
});

const REGIONS = [
  [0, 1, "CRC"], [2, 3, "头"], [4, 4, "微动"], [5, 8, "扳机行程"], [12, 13, "功能位"],
  [14, 13 + 48, "左摇杆槽"], [62, 61 + 48, "右摇杆槽"], [304, 304, "体感模式"],
  [305, 308, "触发键"], [311, 311, "体感反转"], [344, 347, "键位使能"],
  [352, 360, "震动"], [380, 507, "键位槽"],
];
const regionOf = (off) => REGIONS.find((r) => off >= r[0] && off <= r[1])?.[2] ?? "";

function downloadHex() {
  const p = state.draft;
  const lines = [];
  for (let i = 0; i < p.length; i += 32) {
    lines.push(`${String(i).padStart(3, "0")}: ` + [...p.subarray(i, i + 32)]
      .map((x) => x.toString(16).padStart(2, "0")).join(" "));
  }
  const blob = new Blob([lines.join("\n") + "\n"], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "bbw-508.hex";
  a.click();
  URL.revokeObjectURL(a.href);
}
</script>

<template>
  <div class="card">
    <div class="card-head">
      <div class="grow">
        <h2>508 字节</h2>
        <p>
          CRC 0x{{ model?.crc.toString(16).toUpperCase().padStart(4, '0') }} ·
          {{ model?.crcOk ? '自洽' : '异常' }} ·
          <span v-if="diff.length" style="color:rgb(var(--warning))">{{ diff.length }} 字节未写入</span>
          <span v-else>与设备一致</span>
        </p>
      </div>
      <div class="seg">
        <button :class="{ on: tab === 'hex' }" @click="tab = 'hex'">字节</button>
        <button :class="{ on: tab === 'diff' }" @click="tab = 'diff'">差异</button>
        <button :class="{ on: tab === 'log' }" @click="tab = 'log'">日志</button>
      </div>
      <button class="btn sm" @click="downloadHex">导出 hex</button>
      <button class="btn sm ghost" :disabled="!diff.length" @click="revert">撤销</button>
    </div>

    <div v-if="tab === 'hex'" class="mono" style="font-size:11.5px;line-height:1.9;overflow-x:auto">
      <div v-for="(row, i) in blocks" :key="i" style="display:flex;gap:10px;white-space:nowrap">
        <span style="color:rgb(var(--tertiary-foreground));width:34px;text-align:right">{{ String(i * 16).padStart(3, '0') }}</span>
        <span style="display:flex;gap:4px">
          <span v-for="b in row" :key="b.off" :title="`[${b.off}] ${b.v}${regionOf(b.off) ? ' · ' + regionOf(b.off) : ''}`"
            :style="{
              width: '21px', textAlign: 'center', borderRadius: '4px',
              background: changed.has(b.off) ? 'rgb(var(--warning)/.24)' : 'transparent',
              color: changed.has(b.off) ? 'rgb(var(--warning))' : (b.v === 0 ? 'rgb(var(--tertiary-foreground))' : 'inherit'),
            }">{{ b.v.toString(16).padStart(2, '0') }}</span>
        </span>
      </div>
    </div>

    <div v-else-if="tab === 'diff'">
      <div v-if="!diff.length" class="empty" style="padding:30px">
        <div class="hint">没有差异</div>
      </div>
      <table v-else class="tbl">
        <thead><tr><th>偏移</th><th>区域</th><th>设备</th><th>当前</th></tr></thead>
        <tbody>
          <tr v-for="d in diff" :key="d.off">
            <td class="mono">[{{ d.off }}]</td>
            <td class="hint">{{ regionOf(d.off) }}</td>
            <td class="mono">{{ d.from }} <span class="hint">0x{{ d.from.toString(16).padStart(2, '0') }}</span></td>
            <td class="mono chg">{{ d.to }} <span class="hint">0x{{ d.to.toString(16).padStart(2, '0') }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else>
      <pre class="log">{{ state.log.map((l) => l.t.toLocaleTimeString() + '  ' + l.text).join('\n') }}</pre>
      <div v-if="state.mock" style="margin-top:12px">
        <div class="hint" style="margin-bottom:6px">模拟设备</div>
        <pre class="log">{{ mlog.map((l) => new Date(l.t).toLocaleTimeString() + '  ' + l.kind + '  ' + l.text).join('\n') }}</pre>
        <button class="btn sm" style="margin-top:8px" @click="mockReset()">模拟设备恢复出厂</button>
      </div>
    </div>
  </div>
</template>
