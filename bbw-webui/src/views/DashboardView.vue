<script setup>
import { computed } from "vue";
import Icon from "../components/Icon.vue";
import { state, model, diff, diffItems, dirty, connect, read, requestWrite, factoryReset, go } from "../core/store.js";

const t = (ms) => (ms ? new Date(ms).toLocaleTimeString() : "—");
/** 差异项的偏移显示：连续区间写 [a..b]，分散的直接报处数 */
function rangeText(it) {
  const b = it.bytes;
  if (b.length === 1) return `[${b[0]}]`;
  if (b[b.length - 1] - b[0] === b.length - 1) return `[${b[0]}..${b[b.length - 1]}]`;
  return `[${b[0]}] 起`;
}
const mapped = computed(() => (model.value ? model.value.keySlots.filter((s) => s.type).length : 0));
const motionText = computed(() => {
  const m = model.value?.motion;
  if (!m) return "—";
  if (m.mode === 0) return "关闭";
  const target = m.mode === 2 ? "右摇杆" : "左摇杆";
  return m.respond === 0 ? `${target} · 常开` : `${target} · 按键触发`;
});
</script>

<template>
  <!-- 未连接 -->
  <div v-if="!state.connected" class="card glass">
    <div style="max-width:600px;margin:0 auto;text-align:center">
      <h2 style="margin:0 0 8px;font-size:26px;letter-spacing:-0.6px">请连接手柄</h2>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:rgb(var(--muted-foreground))">
        使用 USB 连接手柄后点击按钮。
      </p>
      <div class="row" style="gap:10px;justify-content:center">
        <button class="btn primary lg" style="height:44px;font-size:14px;padding:0 20px" :disabled="state.busy" @click="connect(false)">
          <Icon name="plug" :size="16" />连接设备
        </button>
        <button class="btn lg" style="height:44px;font-size:14px;padding:0 20px" :disabled="state.busy" @click="connect(true)">模拟设备</button>
      </div>

      <div class="card" style="margin-top:22px;padding:16px 18px;background:rgb(var(--foreground)/0.03);box-shadow:none;text-align:left">
        <div style="font-size:14px;font-weight:600;margin-bottom:8px">连接提示</div>
        <ul style="margin:0;padding-left:18px;line-height:2;font-size:13.5px;color:rgb(var(--muted-foreground))">
          <li>配置通道为 MI_02（usagePage 0xFF7A），需 Chrome / Edge 89+</li>
          <li>官方助手会独占设备，连接前请先退出</li>
          <li>模拟设备走同一套协议与校验，写入只落本地</li>
        </ul>
      </div>
    </div>
  </div>

  <!-- 已连接 -->
  <template v-else>
    <div class="grid c4">
      <div class="card glass" style="padding:14px 16px">
        <div class="hint">扳机行程</div>
        <div class="v num" style="font-size:17px;font-weight:650;margin-top:2px">
          {{ model.trigger.left.low }}–{{ model.trigger.left.high }}
          <span class="hint" style="font-weight:500">/</span>
          {{ model.trigger.right.low }}–{{ model.trigger.right.high }}
        </div>
        <div class="hint" style="margin-top:2px">左 / 右（%）</div>
      </div>
      <div class="card glass" style="padding:14px 16px">
        <div class="hint">摇杆死区</div>
        <div class="v num" style="font-size:17px;font-weight:650;margin-top:2px">
          {{ model.sticks.left.deadzone }} / {{ model.sticks.right.deadzone }}
        </div>
        <div class="hint" style="margin-top:2px">左 / 右（% 半径）</div>
      </div>
      <div class="card glass" style="padding:14px 16px">
        <div class="hint">体感</div>
        <div class="v" style="font-size:17px;font-weight:650;margin-top:2px">{{ motionText }}</div>
        <div class="hint" style="margin-top:2px">
          反转 X {{ model.motion.invertX ? '开' : '关' }} · Y {{ model.motion.invertY ? '开' : '关' }}
        </div>
      </div>
      <div class="card glass" style="padding:14px 16px">
        <div class="hint">按键映射</div>
        <div class="v num" style="font-size:17px;font-weight:650;margin-top:2px">{{ mapped }} <span class="hint">/ 32 槽</span></div>
        <div class="hint" style="margin-top:2px">键位使能 0x{{ model.keyEnable.toString(16) }}</div>
      </div>
    </div>

    <div class="grid split">
      <div class="card">
        <div class="card-head">
          <div class="grow">
            <h2>设备</h2>
            <p>{{ state.info?.productName }}</p>
          </div>
          <span class="badge" :class="model.crcOk ? 'ok' : 'err'">
            CRC {{ model.crcOk ? '自洽' : '异常' }}
          </span>
        </div>

        <div class="field">
          <div class="grow">
            <div class="label">设备标识</div>
            <div class="desc">VID 0x{{ (state.info?.vendorId ?? 0).toString(16).toUpperCase() }} · PID 0x{{ (state.info?.productId ?? 0).toString(16).toUpperCase() }}</div>
          </div>
          <span class="badge" :class="state.mock ? 'warn' : 'accent'">{{ state.mock ? '模拟' : 'USB' }}</span>
        </div>
        <div class="field">
          <div class="grow">
            <div class="label">数据流</div>
            <div class="desc">508 字节 · 9 帧 · CRC 0x{{ model.crc.toString(16).toUpperCase().padStart(4, '0') }}</div>
          </div>
          <span class="badge">{{ state.draft?.length ?? 0 }} B</span>
        </div>
        <div class="field">
          <div class="grow">
            <div class="label">最近读取 / 写入</div>
            <div class="desc">{{ t(state.lastReadAt) }} / {{ t(state.lastWriteAt) }}</div>
          </div>
          <div class="row">
            <button class="btn sm" :disabled="state.busy" @click="read">读取</button>
            <button class="btn sm primary" :disabled="!dirty || state.busy" @click="requestWrite">写入</button>
          </div>
        </div>
        <div class="field">
          <div class="grow">
            <div class="label">恢复出厂</div>
            <div class="desc">套用官方默认 508B，需再点写入才下发</div>
          </div>
          <button class="btn sm danger" @click="factoryReset">套用</button>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div class="grow">
            <h2>未写入改动</h2>
            <p>{{ dirty ? `${diffItems.length} 项设置与设备不一致` : '与设备一致' }}</p>
          </div>
          <button class="btn sm ghost" @click="go('debug')">查看</button>
        </div>
        <div v-if="!dirty" class="empty" style="padding:26px 10px">
          <Icon name="check" :size="22" />
          <div class="hint">没有待写入的改动</div>
        </div>
        <table v-else class="tbl">
          <thead><tr><th>设置</th><th>偏移</th><th>字节</th></tr></thead>
          <tbody>
            <tr v-for="it in diffItems.slice(0, 8)" :key="it.key">
              <td>{{ it.label }}</td>
              <td class="mono">{{ rangeText(it) }}</td>
              <td class="mono chg">{{ it.bytes.length }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="diffItems.length > 8" class="hint" style="margin-top:8px">
          其余 {{ diffItems.length - 8 }} 项在调试页查看
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="grow">
          <h2>最近操作</h2>
          <p>读取、写入与解析结果</p>
        </div>
        <button class="btn sm ghost" @click="go('debug')">全部</button>
      </div>
      <div v-if="!state.log.length" class="hint">暂无记录</div>
      <div v-else class="mono" style="font-size:11.5px;line-height:1.9">
        <div v-for="(l, i) in state.log.slice(-6).reverse()" :key="i" class="row" style="gap:10px">
          <span style="color:rgb(var(--tertiary-foreground))">{{ l.t.toLocaleTimeString() }}</span>
          <span>{{ l.text }}</span>
        </div>
      </div>
    </div>
  </template>
</template>
