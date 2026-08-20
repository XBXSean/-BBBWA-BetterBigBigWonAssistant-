<script setup>
// 物理按键学习 v3:双后端(浏览器 Gamepad API 为主 / HID 原始报告为备选)+ 引导式自动识别
// 流程:选择模式 → 校准 → 按顺序提示"请按下 M1(键码0)" → 按下 → 自动记录 → 确认
import { ref, reactive, computed, onBeforeUnmount } from "vue";
import { state, pushLog } from "../lib/store.js";
import { namesStore, saveName, removeName } from "../lib/names-store.js";
import { keyName } from "../lib/names.js";
import { keyCodeToBitmap, bitmapToSlot } from "../../../bbw-protocol/src/keymap.js";
import { computePayloadChecksum } from "../../../bbw-protocol/src/write-format.js";

const GUIDE = Array.from({ length: 25 }, (_, i) => i); // 引导顺序:键码 0..24

const mode = ref("writetest");        // writetest(写测定位,可靠) | gamepad | hid
const listening = ref(false);
const detectBox = ref(null);          // {bk, label, code, name, existing}
const guideIdx = ref(0);
const rawLog = ref([]);
const unsubscribe = ref(null);
let pollTimer = null;
let gpPrev = [];

// 写测定位状态:临时绑定 键码N → 'Q',按实体键定位
const wtCode = ref(0);
const wtName = ref("");
const wtGot = ref(false);             // 检测到 Q 输出
const wtKey = 81;                     // VK 'Q'
const wtHid = 0x14;                   // HID 'q'
const wtQdetect = ref(0);
const wtJumpCode = ref(null);         // 指定键码跳转
const wtDone = computed(() => new Set(Object.entries(namesStore.map)
  .filter(([k]) => k.startsWith("wt:")).map(([, v]) => v.code)));

// HID 后端状态
const calibrating = ref(false);
const ANALOG_HARD = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]); // XInput 布局模拟量
const byteVals = new Map();
const byteChanges = ref([]);        // 逐字节变化计数(诊断:变化多的 = 模拟量)
const autoAnalog = ref([]);         // 变化率法自动识别的模拟量字节
const analogAdaptive = ref([]);
const byteLayout = ref([]);
let lastLayoutHex = "";
let hidPrev = null;
let hidPending = null;
let changeCounts = new Map();
let changeTick = 0;
let totalReports = 0;
const ANALOG_RATE = 0.08;           // 变化率阈值:字节在 ≥8% 报告中有变化 → 模拟量

// Gamepad API 状态
const gpState = reactive({ connected: false, name: "", buttons: 0, active: [] });

const entries = computed(() =>
  Object.entries(namesStore.map).map(([bk, v]) => ({ bitKey: bk, ...v })));
const currentGuide = computed(() => ({ code: GUIDE[guideIdx.value], name: keyName(GUIDE[guideIdx.value]) }));
const doneCount = computed(() => Object.keys(namesStore.map).length);
const gpStatusText = computed(() => {
  if (mode.value !== "gamepad") return "";
  if (!listening.value) return "启动后轮询 navigator.getGamepads(),摇杆/扳机不会干扰按键识别。";
  if (!gpState.connected) return "⚠️ 未检测到 Gamepad(浏览器需允许手柄;部分手柄需先在其他程序里激活一次)";
  return "🎮 已检测:" + gpState.name.slice(0, 40) + "(" + gpState.buttons + " 键),当前按下:" + (gpState.active.join(",") || "无");
});

function detect(bk, label) {
  const existing = namesStore.map[bk];
  detectBox.value = {
    bk, label,
    code: currentGuide.value.code,
    name: currentGuide.value.name,
    existing: existing ? `${existing.name}(键码${existing.code})` : null,
  };
}

/* ── Gamepad API 后端(主):轮询 navigator.getGamepads(),无模拟量混淆 ── */
function gpPoll() {
  const gps = navigator.getGamepads();
  const gp = gps.find((g) => g && g.connected);
  gpState.connected = !!gp;
  if (!gp) { gpState.active = []; gpPrev = []; return; }
  gpState.name = gp.id;
  gpState.buttons = gp.buttons.length;
  const active = [];
  for (let i = 0; i < gp.buttons.length; i++) {
    const pressed = gp.buttons[i].pressed || gp.buttons[i].value > 0.5;
    if (pressed) active.push(i);
    const was = gpPrev[i] || false;
    const bk = "gp:" + i;
    if (pressed && !was) {
      hidPending = { bk, count: 1 }; // 复用 pending 槽(单后端活跃)
    } else if (pressed && was) {
      if (hidPending && hidPending.bk === bk) {
        hidPending.count++;
        if (hidPending.count >= 2) {
          hidPending = null;
          detect(bk, `Gamepad 按钮 ${i}`);
        }
      }
    } else if (!pressed) {
      if (hidPending && hidPending.bk === bk) hidPending = null;
    }
    gpPrev[i] = pressed;
  }
  gpState.active = active;
}

/* ── HID 原始报告后端(备选):IG_00,变化率自动识别模拟量 + XInput 硬排除 + 防抖 ── */
function classifyAnalog() {
  // 变化率法:报告数足够后,变化率 ≥ 阈值的字节 = 模拟量
  // (需要用户大幅移动摇杆/扳机,让变化率暴露出来)
  if (totalReports >= 40) {
    const out = [];
    for (const [i, n] of changeCounts) {
      if (n / totalReports >= ANALOG_RATE && n >= 5) out.push(i);
    }
    autoAnalog.value = out.sort((a, b) => a - b);
  }
  const out2 = [];
  for (const [i, s] of byteVals) if (s.size >= 4 && !ANALOG_HARD.has(i)) out2.push(i);
  analogAdaptive.value = out2.sort((a, b) => a - b);
}
function isAnalogByte(i) {
  // 自动识别(变化率)优先,其次 XInput 硬排除(猜测)
  return autoAnalog.value.includes(i) || ANALOG_HARD.has(i);
}

function onHidReport(b) {
  rawLog.value.push(`${b.length}B: ` + [...b].map((x) => x.toString(16).padStart(2, "0")).join(" "));
  if (rawLog.value.length > 24) rawLog.value.shift();
  // 逐字节变化计数(诊断:模拟量字节变化频繁 —— 需大幅移动摇杆/扳机才能暴露)
  changeTick++;
  totalReports++;
  if (hidPrev) {
    for (let i = 0; i < Math.min(b.length, hidPrev.length); i++) {
      if (b[i] !== hidPrev[i]) changeCounts.set(i, (changeCounts.get(i) || 0) + 1);
    }
  }
  if (changeTick % 15 === 0) {
    byteChanges.value = [...changeCounts.entries()]
      .map(([i, n]) => ({ i, n, rate: totalReports ? Math.round((n / totalReports) * 100) : 0 }))
      .sort((a, b) => b.n - a.n);
  }
  for (let i = 0; i < b.length; i++) {
    let s = byteVals.get(i);
    if (!s) { s = new Set(); byteVals.set(i, s); }
    s.add(b[i]);
    if (s.size > 40) s.clear();
  }
  classifyAnalog();
  if (calibrating.value && totalReports >= 40) {
    calibrating.value = false;
    pushLog("校准完成;自动识别模拟量字节:" + (autoAnalog.value.length ? autoAnalog.value.join(",") : "(变化率未达阈值,请大幅移动摇杆/扳机)"));
  }
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ");
  if (hex !== lastLayoutHex) {
    lastLayoutHex = hex;
    byteLayout.value = [...b].map((x, i) => ({ i, hex: x.toString(16).padStart(2, "0"), analog: isAnalogByte(i) }));
  }
  if (!hidPrev) { hidPrev = b.slice(); return; }
  for (let i = 0; i < b.length; i++) {
    if (isAnalogByte(i)) continue;
    const cur = b[i], prv = hidPrev[i] ?? 0;
    for (let bit = 0; bit < 8; bit++) {
      const nowSet = (cur >> bit) & 1;
      const wasSet = (prv >> bit) & 1;
      const bk = `b${i}:${bit}`;
      if (nowSet && !wasSet) {
        hidPending = { bk, count: 1 };
      } else if (nowSet && wasSet) {
        if (hidPending && hidPending.bk === bk) {
          hidPending.count++;
          if (hidPending.count >= 2) {
            hidPending = null;
            detect(bk, `报告字节${i} 位${bit}`);
          }
        }
      } else if (!nowSet) {
        if (hidPending && hidPending.bk === bk) hidPending = null;
      }
    }
  }
  hidPrev = b.slice();
}

/* ── 启动/停止 ── */
function start() {
  if (mode.value === "hid" && !state.transport) { pushLog("HID 模式需要先连接设备"); return; }
  listening.value = true;
  detectBox.value = null;
  guideIdx.value = 0;
  hidPending = null;
  rawLog.value = [];
  if (mode.value === "hid") {
    calibrating.value = true;
    byteVals.clear();
    analogAdaptive.value = [];
    autoAnalog.value = [];
    hidPrev = null;
    byteLayout.value = [];
    changeCounts = new Map();
    byteChanges.value = [];
    changeTick = 0;
    totalReports = 0;
    if (!state.transport.gamepad) pushLog("未找到游戏手柄通道(IG_00),从配置设备转发非配置帧");
    pushLog("HID 学习:请【大幅画圈摇动摇杆 + 反复扣扳机】5 秒(让变化计数暴露模拟量),然后按要学习的键");
    unsubscribe.value = state.transport.onGamepad(onHidReport);
  } else {
    if (!("getGamepads" in navigator)) { pushLog("浏览器不支持 Gamepad API,切换到 HID 模式"); mode.value = "hid"; start(); return; }
    pushLog("Gamepad API 学习:按提示按下实体键即可(摇杆/扳机不会干扰)");
    pollTimer = setInterval(gpPoll, 30);
  }
}
function stop() {
  listening.value = false;
  if (unsubscribe.value) { unsubscribe.value(); unsubscribe.value = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  gpPrev = [];
  gpState.active = [];
}
function confirmDetect() {
  const d = detectBox.value;
  if (!d) return;
  const existing = namesStore.map[d.bk];
  if (existing && existing.code !== d.code) {
    if (!confirm(`该键已学习为「${existing.name}」(键码${existing.code})。覆盖为「${d.name}」(键码${d.code})?`)) return;
  }
  saveName(d.bk, d.name, d.code);
  pushLog(`已学习:${d.bk} → ${d.name}(键码${d.code})`);
  detectBox.value = null;
  guideIdx.value = Math.min(guideIdx.value + 1, GUIDE.length - 1);
}
function skipDetect() {
  detectBox.value = null;
  guideIdx.value = Math.min(guideIdx.value + 1, GUIDE.length - 1);
  pushLog("跳过,下一键…");
}
function copyRaw() {
  if (!rawLog.value.length) return;
  navigator.clipboard.writeText(rawLog.value.join("\n")).then(
    () => pushLog("原始报告已复制"),
    () => pushLog("复制失败")
  );
}

/* ── 写测定位模式:临时绑定 键码N → 键盘 'Q',按实体键定位 ── */
async function wtWrite(code) {
  if (!state.payload) { pushLog("请先在连接页读取配置(作为基线)"); return false; }
  const bm = keyCodeToBitmap(code);
  const slot = bitmapToSlot(bm);
  if (slot === -1) { pushLog(`键码 ${code} 无槽位`); return false; }
  const p = state.payload.slice();
  const so = 380 + slot * 4;
  p[so] = 2; p[so + 1] = 0; p[so + 2] = wtHid; p[so + 3] = 0; // 宏 'Q' = [02 00 14 00]
  const cs = computePayloadChecksum(p);
  p[0] = (cs >> 8) & 0xff; p[1] = cs & 0xff;
  await state.transport.writeProfile(p);
  return true;
}
async function wtStart() {
  if (!state.transport) { pushLog("请先连接设备"); return; }
  if (!state.payload) { pushLog("请先在连接页点「读取」获得基线配置"); return; }
  if (!confirm("写测定位会向设备写临时绑定(键码N → 键盘 Q),完成后自动恢复原配置。继续?")) return;
  listening.value = true;
  wtCode.value = 0;
  wtGot.value = false;
  wtQdetect.value = 0;
  wtName.value = "";
  pushLog(`写测定位:为键码 0 写入临时绑定 'Q'…`);
  if (await wtWrite(0)) pushLog("已写入。请聚焦测试框,逐个按手柄按钮找 Q");
}
async function wtRestore() {
  if (!state.payload) return;
  if (confirm("恢复设备原配置(撤销所有测试绑定)?")) {
    await state.transport.writeProfile(state.payload);
    pushLog("已恢复原配置");
  }
}
async function wtConfirm() {
  // 当前键码 = 用户确认的输出按钮
  const name = wtName.value.trim() || keyName(wtCode.value);
  saveName(`wt:${wtCode.value}`, name, wtCode.value);
  pushLog(`定位:键码${wtCode.value} = ${name}`);
  wtGot.value = false;
  wtName.value = "";
  wtQdetect.value = 0;
  const next = wtCode.value + 1;
  if (next > 24) { listening.value = false; pushLog("全部完成"); await wtRestore(); return; }
  wtCode.value = next;
  pushLog(`为键码 ${next} 写入临时绑定 'Q'…`);
  if (await wtWrite(next)) pushLog("已写入。请继续按按钮找 Q");
}
async function wtSkip() {
  wtGot.value = false;
  wtQdetect.value = 0;
  const next = wtCode.value + 1;
  if (next > 24) { listening.value = false; pushLog("全部完成"); await wtRestore(); return; }
  wtCode.value = next;
  pushLog(`跳过键码${wtCode.value - 1};为键码 ${next} 写入临时绑定 'Q'…`);
  if (await wtWrite(next)) pushLog("已写入。请继续按按钮找 Q");
}

/** 指定键码重新学习:跳转到任意键码并写入临时绑定 */
async function wtJump(code) {
  if (!state.transport) { pushLog("请先连接设备"); return; }
  if (!state.payload) { pushLog("请先在连接页点「读取」获得基线配置"); return; }
  if (code < 0 || code > 24) { pushLog("键码需在 0..24"); return; }
  if (!listening.value) listening.value = true;
  wtCode.value = code;
  wtGot.value = false;
  wtQdetect.value = 0;
  wtName.value = "";
  pushLog(`指定键码 ${code}(${keyName(code)}):写入临时绑定 'Q'…`);
  if (await wtWrite(code)) pushLog("已写入。请聚焦测试框,按实体键找 Q(扳机要拉满)");
}
onBeforeUnmount(() => { stop(); if (state.transport && state.payload && mode.value === "writetest") state.transport.writeProfile(state.payload); });
</script>

<template>
  <div class="card">
    <h2>物理按键定位 / 学习</h2>
    <p class="desc">
      三种方式找出"实体键 ↔ 键码"对应关系:<b>写测定位</b>(写临时绑定键码N→键盘Q,
      按实体键看哪个出 Q —— 最可靠);<b>Gamepad API</b>(浏览器抽象,无模拟量干扰);
      <b>HID 原始报告</b>(直接解析 IG_00,需校准)。
    </p>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <select v-model="mode" :disabled="listening" style="width:200px">
        <option value="writetest">✍ 写测定位(可靠)</option>
        <option value="gamepad">🎮 Gamepad API</option>
        <option value="hid">🔌 HID 原始报告</option>
      </select>
      <button v-if="!listening" class="btn primary" :disabled="mode==='hid' && !state.connected" @click="start">开始学习</button>
      <button v-else class="btn danger" @click="stop">停止</button>
      <span class="badge" :class="listening ? 'ok' : 'muted'">{{ listening ? "● 监听中" : "未监听" }}</span>
      <span v-if="listening" class="badge muted">已学 {{ doneCount }} / 25</span>
      <span v-if="listening && mode==='hid' && calibrating" class="badge warn">校准中:大幅画圈摇杆 + 反复扣扳机…</span>
    </div>

    <!-- 写测定位 -->
    <div v-if="mode === 'writetest'" style="margin-top:10px">
      <div v-if="!listening" class="hint">
        机制:临时把「键码 N」绑定为键盘 <b>Q</b>,你在<b>下面测试框</b>聚焦后逐个按手柄按钮,
        哪个按钮让测试框出现 <b>Q</b>,那个按钮就是键码 N。M1..M4 = 键码 0..3 已确认,可跳过。
        结束后自动恢复原配置。
      </div>
      <div v-else>
        <div style="margin-bottom:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="hint">指定键码再次学习:</span>
          <select v-model.number="wtJumpCode" style="width:110px">
            <option v-for="c in 25" :key="c - 1" :value="c - 1">键码{{ c - 1 }} ({{ keyName(c - 1) }})</option>
          </select>
          <button class="btn small primary" @click="wtJump(wtJumpCode ?? 0)">写入该键码的测试绑定</button>
          <button class="btn small" @click="wtRestore">恢复原配置</button>
        </div>
        <div style="margin-bottom:10px">
          <span class="hint">键码网格(绿 = 已定位,点格子跳转):</span>
          <div style="display:grid;grid-template-columns:repeat(10, 44px);gap:4px;margin-top:4px">
            <button v-for="c in 25" :key="c - 1" class="btn small"
              :class="{ primary: wtCode === c - 1 }"
              :style="wtDone.has(c - 1) && wtCode !== c - 1 ? 'background:rgb(var(--success)/.25);border-color:rgb(var(--success))' : ''"
              @click="wtJump(c - 1)">{{ c - 1 }}</button>
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start">
          <div class="recorder" style="flex:1;min-width:300px">
            <div style="font-size:15px">当前定位:键码 <b>{{ wtCode }}</b>
              <span class="hint">({{ keyName(wtCode) }})</span>
            </div>
            <div class="hint" style="margin:8px 0">先点击下面测试框,再逐个按手柄按钮 —— 哪个按钮让它出现 <b>Q</b>?</div>
            <textarea ref="wtBox" rows="2" placeholder="点击这里聚焦,然后按手柄按钮…"
              @keydown="wtQdetect = (wtQdetect || 0) + (($event.key === 'q' || $event.key === 'Q') ? 1 : 0); if ($event.key === 'q' || $event.key === 'Q') wtGot = true"
              style="width:100%"></textarea>
            <div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span v-if="wtGot" class="badge ok">✅ 检测到 Q 输出!它是哪个按钮?</span>
              <span v-else class="badge muted">已输出 Q × {{ wtQdetect }}</span>
              <input v-model="wtName" type="text" placeholder="按钮名,如 LB / LT / 左肩…" style="width:150px">
              <button class="btn primary small" :disabled="!wtGot" @click="wtConfirm">就是这个按钮</button>
              <button class="btn small" @click="wtSkip">跳过此键码</button>
            </div>
          </div>
          <div style="flex:1;min-width:280px">
            <h3>当前已定位</h3>
            <table class="tbl">
              <thead><tr><th>键码</th><th>名称</th></tr></thead>
              <tbody>
                <tr v-for="c in Math.min(wtCode + 1, 25)" :key="c - 1">
                  <td>{{ c - 1 }}</td>
                  <td>{{ (namesStore.map['wt:' + (c - 1)] || {}).name || keyName(c - 1) }}</td>
                </tr>
              </tbody>
            </table>
            <button class="btn small danger" style="margin-top:8px" @click="wtRestore">恢复原配置</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Gamepad API 状态 -->
    <div v-if="mode === 'gamepad'" style="margin-top:10px" class="hint">
      {{ gpStatusText }}
    </div>

    <!-- HID 原始报告诊断 -->
    <div v-if="mode === 'hid' && listening" style="margin-top:10px">
      <div v-if="state.transport && state.transport.devicesSeen" class="hint">
        枚举到 {{ state.transport.devicesSeen.length }} 个设备:
        <pre class="log" style="max-height:90px">{{ JSON.stringify(state.transport.devicesSeen, null, 1) }}</pre>
      </div>
      <div class="hint">收到的报告(灰 = 模拟量已忽略):
        <span v-for="(x, i) in byteLayout" :key="i" :style="{ opacity: x.analog ? 0.35 : 1 }" class="hexrow"> {{ x.hex }}</span>
      </div>
      <div style="margin-top:6px">
        <h3>逐字节变化计数(变化率越高越是模拟量 —— 请大幅画圈摇杆/反复扣扳机)</h3>
        <span v-if="byteChanges.length" class="hint">{{ byteChanges.slice(0, 10).map((c) => `字节${c.i}:${c.n}(${c.rate}%)`).join("  ") }}</span>
        <span v-if="autoAnalog.length" class="badge ok" style="margin-left:6px">已自动排除模拟量:{{ autoAnalog.join(",") }}</span>
        <span v-else-if="totalReports >= 40" class="badge warn">未达阈值 —— 摇杆/扳机还没大幅移动</span>
        <span v-else class="badge muted">采样 {{ totalReports }} / 40 …</span>
      </div>
      <div v-if="rawLog.length" style="margin-top:6px">
        <h3>原始报告流(含长度)</h3>
        <pre class="log" style="max-height:120px">{{ rawLog.join("\n") }}</pre>
        <button class="btn small" @click="copyRaw">复制报告</button>
      </div>
      <div v-if="!rawLog.length" class="hint">还没有收到任何报告 —— 若一直空白,说明游戏手柄通道没打通(可把上方枚举信息复制后提交 Issue)。</div>
    </div>

    <div v-if="listening && mode !== 'writetest'" class="recorder" style="margin-top:12px">
      <template v-if="detectBox">
        <div style="font-size:15px;margin-bottom:8px">✅ 检测到:<b>{{ detectBox.label }}</b></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
          <span style="font-size:14px">它将是 <b>{{ detectBox.name }}</b>(键码 {{ detectBox.code }})</span>
          <span v-if="detectBox.existing" class="badge warn">该键已学为 {{ detectBox.existing }}</span>
          <button class="btn primary small" @click="confirmDetect">确认</button>
          <button class="btn small" @click="skipDetect">跳过</button>
        </div>
        <div class="hint" style="margin-top:6px">不是这个键?点「跳过」</div>
      </template>
      <template v-else>
        <div style="font-size:16px">👉 请按下 <b>{{ currentGuide.name }}</b> <span class="hint">(键码 {{ currentGuide.code }})</span></div>
        <div class="hint" style="margin-top:6px">按住直到出现确认框;没有该键点「跳过」</div>
      </template>
    </div>

    <div v-if="entries.length" style="margin-top:12px">
      <h3>已学习({{ entries.length }})</h3>
      <table class="tbl">
        <thead><tr><th>来源键</th><th>键码</th><th>名称</th><th></th></tr></thead>
        <tbody>
          <tr v-for="e in entries" :key="e.bitKey">
            <td class="hexrow">{{ e.bitKey }}</td>
            <td>{{ e.code }}</td>
            <td>{{ e.name }}</td>
            <td><button class="btn small danger" @click="removeName(e.bitKey)">删除</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
