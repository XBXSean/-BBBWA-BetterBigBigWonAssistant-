#!/usr/bin/env node
/**
 * trig-measure.mjs —— 「配置改动 → 扳机输出」差分测量（XInput 通道）
 *
 * 前提：人把同一个扳机固定在**中间行程**不动。
 *   死区/曲线映射的是物理行程，满值(255)处任何阈值设置都仍是 255，测不出差异。
 * 流程：
 *   阶段1 逐槽把死区顶到 99 → 哪个槽让 LT 塌下去，就是管左扳机的那槽
 *   阶段2 对该槽把死区从 0 扫到 99 → 得到「死区 vs 输出」曲线
 *   阶段3 对该槽的 12 个参数字节逐个试 0/128/255 → 找出真正影响输出的字节
 * 每步结束都写回基线；全程不触碰震动区段 [352..360]。
 */
import { HID, devices as hidDevices } from "node-hid";
import { spawnSync } from "node:child_process";
import {
  chunkPayload, dechunkFrames, READ_QUERY, MARKER_READ,
  computePayloadChecksum, parseWritePayload, TRIGGER_RECORD_OFFSETS,
} from "../src/index.js";

const VID = 0x413d;
const PID = 0x2104;
const CONFIG_UP = 0xff7a;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function openConfig() {
  const d = hidDevices().find((x) => x.vendorId === VID && x.productId === PID &&
    (x.usagePage ?? x.usage_page) === CONFIG_UP);
  if (!d) throw new Error("找不到配置通道(MI_02 / 0xFF7A)");
  return new HID(d.path);
}

function sendReport(dev, frame) {
  try { dev.write([0x00, ...frame]); } catch { dev.write([...frame]); }
}

function readConfig(dev) {
  sendReport(dev, READ_QUERY);
  const frames = [];
  const t0 = Date.now();
  while (frames.length < 9 && Date.now() - t0 < 1500) {
    const b = dev.readTimeout(200);
    if (!b || !b.length) continue;
    const f = b.length === 65 ? b.subarray(1) : b;
    if (f[0] === 0xa4) frames.push(Uint8Array.from(f));
  }
  if (frames.length < 9) throw new Error(`配置读回只有 ${frames.length}/9 帧`);
  return dechunkFrames(frames, { validate: true, marker: MARKER_READ });
}

function writeConfig(dev, payload) {
  const p = Uint8Array.from(payload);
  const cs = computePayloadChecksum(p);
  p[0] = (cs >> 8) & 0xff;
  p[1] = cs & 0xff;
  for (const f of chunkPayload(p)) sendReport(dev, f);
}

function sampleXInput(ms) {
  const r = spawnSync("python", ["tools/xinput-sample.py", "--ms", String(ms)], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || "xinput 采样失败");
  const j = JSON.parse(r.stdout.trim().split("\n").pop());
  if (j.error) throw new Error(j.error);
  return j;
}

const mid = (s) => (s.min + s.max) / 2;

const dev = openConfig();
try {
  const base = readConfig(dev);
  const cfg = parseWritePayload(base);
  console.log(`基线 ${base.length}B  CRC 自洽=${cfg.checksumOk}`);

  const idle = sampleXInput(450);
  console.log(`当前行程读数：LT=${mid(idle.lt)}  RT=${mid(idle.rt)}`);
  if (idle.lt.min >= 250) {
    console.log("⚠ 左扳机仍在满值：饱和点上方一律 255，死区/曲线测不出差异。");
    console.log("   （配置实时生效已单独验证过：[5]=100 会让 LT 立即归零，那是整个行程落入死区）");
    console.log("   请把皮筋调到约 50% 行程再跑本脚本。");
  }

  // ---- 阶段1：定位槽 ----
  console.log("\n=== 阶段1：哪个槽管左扳机（该槽死区=99）===");
  const rows = [];
  let bestSlot = -1;
  let bestDrop = 0;
  for (let slot = 0; slot < TRIGGER_RECORD_OFFSETS.length; slot++) {
    const off = TRIGGER_RECORD_OFFSETS[slot];
    const p = Uint8Array.from(base);
    p[off + 2] = 99;
    writeConfig(dev, p);
    await sleep(160);
    const s = sampleXInput(300);
    writeConfig(dev, base);
    await sleep(140);
    const drop = Math.abs(mid(s.lt) - mid(idle.lt));
    if (drop > bestDrop) { bestDrop = drop; bestSlot = slot; }
    rows.push({ 槽: slot, 起始: off, 死区99时LT: mid(s.lt), 基线LT: mid(idle.lt), 变化量: drop });
  }
  console.table(rows);

  if (bestSlot < 0 || bestDrop < 8) {
    console.log(`没能定位到槽（最大变化量 ${bestDrop}）。当前行程可能落在死区两侧，换个位置再试。`);
    process.exit(0);
  }

  const off = TRIGGER_RECORD_OFFSETS[bestSlot];
  console.log(`→ 左扳机 = 槽 ${bestSlot}（起点 ${off}），当前死区字节 [${off + 2}] = ${base[off + 2]}`);

  // ---- 阶段2：死区扫描 ----
  console.log("\n=== 阶段2：死区字节扫描 ===");
  const sweep = [];
  for (const v of [0, 5, 10, 15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 99]) {
    const p = Uint8Array.from(base);
    p[off + 2] = v;
    writeConfig(dev, p);
    await sleep(150);
    const s = sampleXInput(280);
    sweep.push({ 死区: v, LT: mid(s.lt) });
  }
  writeConfig(dev, base);
  await sleep(150);
  console.table(sweep);

  // ---- 阶段3：曲线参数逐字节 ----
  console.log("\n=== 阶段3：槽内 12 个参数字节的影响 ===");
  const params = [];
  for (let i = 3; i < 15; i++) {
    const o = off + i;
    if (o >= 352 && o <= 360) continue;
    const line = { 偏移: o, 基线: base[o], 写0: 0, 写128: 0, 写255: 0 };
    for (const v of [0, 128, 255]) {
      const p = Uint8Array.from(base);
      p[o] = v;
      writeConfig(dev, p);
      await sleep(140);
      const s = sampleXInput(260);
      line[`写${v}`] = mid(s.lt);
    }
    writeConfig(dev, base);
    await sleep(120);
    params.push(line);
  }
  console.table(params);

  const back = readConfig(dev);
  console.log(`结束：已还原基线，CRC 自洽=${parseWritePayload(back).checksumOk}`);
} finally {
  dev.close();
}
