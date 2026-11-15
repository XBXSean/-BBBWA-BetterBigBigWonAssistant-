#!/usr/bin/env node
/**
 * axis-invert-test.mjs —— 体感轴反转位（[311] bit1/bit2）的真机判定
 *
 * 前提：手柄被固定在某个稳定倾角上（体感 → 摇杆，静态倾角 = 恒定偏转）。
 * 步骤：
 *   1. 若 [304] 高半字节 ≠ 0（按下触发），先改回 0x0x（常开），否则静止时无输出
 *   2. 基线采样（[311] 原值）
 *   3. 依次写 [311] | 2、| 4、| 6，各 settle 800ms 后采 1.5s
 *   4. 还原 [311]，最后把整份原始配置写回
 *
 * 判据：某一位置位后对应轴的中点值符号翻转、幅度基本不变 → 该位就是该轴的反转开关。
 *
 * 用法：
 *   node tools/axis-invert-test.mjs [--ms 1500] [--settle 800] [--keep-mode]
 *   --keep-mode  不改 [304]（默认会临时改成常开）
 */
import { HID, devices as hidDevices } from "node-hid";
import { spawnSync } from "node:child_process";
import {
  chunkPayload, dechunkFrames, READ_QUERY, MARKER_READ,
  computePayloadChecksum, parseWritePayload,
} from "../src/index.js";

const VID = 0x413d, PID = 0x2104, CONFIG_UP = 0xff7a;
const SHOCK_LO = 352, SHOCK_HI = 360;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const getArg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const MS = Number(getArg("--ms", "1500"));
const SETTLE = Number(getArg("--settle", "800"));
const KEEP_MODE = argv.includes("--keep-mode");

/* ---------------- HID ---------------- */
function openConfig() {
  const d = hidDevices().find((x) => x.vendorId === VID && x.productId === PID &&
    (x.usagePage ?? x.usage_page) === CONFIG_UP);
  if (!d) throw new Error("找不到配置通道(MI_02 / 0xFF7A)。官方助手是否还开着？");
  return new HID(d.path);
}
const sendReport = (dev, f) => { try { dev.write([0x00, ...f]); } catch { dev.write([...f]); } };
function readConfig(dev) {
  sendReport(dev, READ_QUERY);
  const frames = []; const t0 = Date.now();
  while (frames.length < 9 && Date.now() - t0 < 1500) {
    const b = dev.readTimeout(200); if (!b || !b.length) continue;
    const f = b.length === 65 ? b.subarray(1) : b;
    if (f[0] === 0xa4) frames.push(Uint8Array.from(f));
  }
  if (frames.length < 9) throw new Error(`配置读回只有 ${frames.length}/9 帧`);
  return dechunkFrames(frames, { validate: true, marker: MARKER_READ });
}
function writeConfig(dev, payload) {
  const p = Uint8Array.from(payload);
  const cs = computePayloadChecksum(p);
  p[0] = (cs >> 8) & 0xff; p[1] = cs & 0xff;
  for (const f of chunkPayload(p)) sendReport(dev, f);
}
function assertNoShock(a, b) {
  for (let i = SHOCK_LO; i <= SHOCK_HI; i++) {
    if (a[i] !== b[i]) throw new Error(`载荷改动了震动区段 [${i}] ${a[i]}→${b[i]}，拒绝下发`);
  }
}
function sample(ms) {
  const r = spawnSync("python", ["tools/xinput-sample.py", "--ms", String(ms)], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || "xinput 采样失败");
  const j = JSON.parse(r.stdout.trim().split("\n").pop());
  if (j.error) throw new Error(j.error);
  return j;
}
const mid = (s) => (typeof s.med === "number" ? s.med : (s.min + s.max) / 2);
const spread = (s) => (s.p95 ?? s.max) - (s.p05 ?? s.min);
const f = (x) => String(Math.round(x)).padStart(7);

/** 两轮采样取中位数，避免单轮偶发抖动 */
function sampleAvg(ms) {
  const a = sample(Math.round(ms / 2));
  const b = sample(Math.round(ms / 2));
  return {
    rx: Math.round((mid(a.rx) + mid(b.rx)) / 2),
    ry: Math.round((mid(a.ry) + mid(b.ry)) / 2),
    lx: Math.round((mid(a.lx) + mid(b.lx)) / 2),
    ly: Math.round((mid(a.ly) + mid(b.ly)) / 2),
    noise: Math.max(spread(a.rx), spread(a.ry)),
    buttons: b.buttons,
  };
}

/* ---------------- 主流程 ---------------- */
const dev = openConfig();
try {
  const orig = readConfig(dev);
  const p0 = parseWritePayload(orig);
  console.log(`读回 ${orig.length}B  CRC 自洽=${p0.checksumOk}`);
  console.log(`[304]=0x${orig[304].toString(16).padStart(2, "0")} (响应方式=高半字节 ${orig[304] >> 4}, 传感器=${orig[304] & 0xf})  [311]=0x${orig[311].toString(16).padStart(2, "0")}  sim_keys=0x${p0.motion?.simKeys?.toString(16) ?? "?"}`);

  // 1) 保证体感常开，否则「按下触发」模式下静止无输出
  let working = Uint8Array.from(orig);
  if (!KEEP_MODE && (orig[304] >> 4) !== 0) {
    working[304] = orig[304] & 0x0f;
    assertNoShock(orig, working);
    console.log(`\n[304] 0x${orig[304].toString(16)} → 0x${working[304].toString(16)}（临时改常开）`);
    writeConfig(dev, working);
    await sleep(2000); // 写 [304] 会触发 USB 重枚举
    working = readConfig(dev);
    console.log(`回读确认 [304]=0x${working[304].toString(16).padStart(2, "0")}`);
  }
  const axisBase = working[311];

  // 2) 基线
  console.log(`\n基线 [311]=0x${axisBase.toString(16).padStart(2, "0")}，采样…`);
  const b0 = sampleAvg(MS);
  console.log(`   RX=${f(b0.rx)} RY=${f(b0.ry)}  LX=${f(b0.lx)} LY=${f(b0.ly)}  噪声=${b0.noise}`);

  // 3) 逐位测试
  const candidates = [...new Set([axisBase, axisBase | 2, axisBase | 4, axisBase | 6])].filter(
    (v) => v !== axisBase,
  );
  const rows = [];
  for (const v of candidates) {
    const p = Uint8Array.from(working);
    p[311] = v;
    assertNoShock(working, p);
    writeConfig(dev, p);
    await sleep(SETTLE);
    const s = sampleAvg(MS);
    rows.push({
      "311": `0x${v.toString(16).padStart(2, "0")}`,
      置位: [1, 2, 4, 8].filter((b) => v & b).join("+") || "0",
      RX: s.rx, RY: s.ry, LX: s.lx, LY: s.ly,
      "ΔRX": s.rx - b0.rx, "ΔRY": s.ry - b0.ry,
      "RY/RX": s.rx ? (s.ry / s.rx).toFixed(3) : "-",
      噪声: s.noise,
    });
    console.log(`  [311]=0x${v.toString(16)} → RX=${f(s.rx)} RY=${f(s.ry)}  LX=${f(s.lx)} LY=${f(s.ly)}`);
  }

  console.table(rows);
  console.log("\n判读：某位置位后 RX（或 RY）符号翻转、绝对值接近 → 该位就是该轴的反转。");
  console.log("      若 RX/RY 比值在各位下保持不变，只整体变号，则是「整体镜像」而非单轴反转。");

  // 4) 还原 [311]，并把整份原始配置写回（含 [304]）
  const p1 = Uint8Array.from(working); p1[311] = axisBase;
  writeConfig(dev, p1);
  await sleep(SETTLE);
  assertNoShock(orig, orig);
  writeConfig(dev, orig);
  await sleep(2000);
  const back = readConfig(dev);
  let diff = 0;
  for (let i = 0; i < 508; i++) if (back[i] !== orig[i]) diff++;
  console.log(`\n结束：${diff ? `⚠ 还原后仍有 ${diff}B 差异` : "原始配置已完整还原 ✅（[304]/[311] 均回到你设置的状态）"}`);
} finally { dev.close(); }
