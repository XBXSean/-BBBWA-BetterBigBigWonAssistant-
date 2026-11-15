#!/usr/bin/env node
/**
 * measure-trigger.mjs —— 扳机槽 ↔ 输入通道 的定位实验
 *
 * 前提:人把某个扳机固定在某个位置(本实验用"左扳机绑死最大、右扳机不动"),
 * 然后逐个扳机槽改死区,看输入报告里哪个通道跟着变 —— 从而确定:
 *   1. 6 个扳机槽分别对应哪个物理扳机
 *   2. 该扳机在输入报告里的字节位置
 *
 * 不触碰震动区段 [352..360]。
 */
import { HID, devices as hidDevices } from "node-hid";
import { readFileSync } from "node:fs";
import {
  chunkPayload, dechunkFrames, READ_QUERY, MARKER_READ,
  parseWritePayload, computePayloadChecksum,
  TRIGGER_RECORD_OFFSETS,
} from "../src/index.js";

const VID = 0x413d, PID = 0x2104;
const CONFIG_UP = 0xff7a, GAME_UP = 0x0001;
const PAYLOAD_SIZE = 508;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pick(up, usage) {
  const d = hidDevices().find((x) =>
    x.vendorId === VID && x.productId === PID &&
    (x.usagePage ?? x.usage_page) === up && (usage === undefined || x.usage === usage));
  if (!d) throw new Error(`找不到 usagePage=0x${up.toString(16)} 的接口`);
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
  p[0] = (cs >> 8) & 0xff; p[1] = cs & 0xff;
  for (const f of chunkPayload(p)) sendReport(dev, f);
}

/** 采样输入报告 ms 毫秒,返回每字节的最后值/最小/最大 */
async function sampleInput(dev, ms) {
  const stats = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const b = dev.readTimeout(60);
    if (!b || !b.length) continue;
    for (let i = 0; i < b.length; i++) {
      const s = stats[i] ?? (stats[i] = { min: 255, max: 0, last: 0 });
      if (b[i] < s.min) s.min = b[i];
      if (b[i] > s.max) s.max = b[i];
      s.last = b[i];
    }
  }
  return stats;
}

const cfgDev = pick(CONFIG_UP);
const inDev = pick(GAME_UP, 0x05);

try {
  const base = readConfig(cfgDev);
  console.log(`基线已读:${base.length}B,CRC 自洽=${parseWritePayload(base).checksumOk}`);

  // 1) 空转基线采样:记录没有改配置时的自然抖动
  await sleep(200);
  const idle = await sampleInput(inDev, 700);
  console.log(`基线采样(未改配置,650ms):`);
  console.table(idle.map((s, i) => ({ 字节: i, 最小: s.min, 最大: s.max, 末值: s.last, 抖动: s.max - s.min })));

  const fmt = (s) => s ? `${s.min}..${s.max}` : "—";

  // 2) 逐槽把死区顶到 99,看哪个通道塌下去
  for (let slot = 0; slot < TRIGGER_RECORD_OFFSETS.length; slot++) {
    const off = TRIGGER_RECORD_OFFSETS[slot];
    const p = Uint8Array.from(base);
    p[off + 2] = 99; // 该槽死区
    writeConfig(cfgDev, p);
    await sleep(250);
    const s = await sampleInput(inDev, 600);
    const lines = [];
    for (let i = 0; i < Math.max(idle.length, s.length); i++) {
      const a = idle[i], b = s[i];
      if (!a || !b) continue;
      if (a.last !== b.last || Math.abs(a.max - b.max) > 20) {
        lines.push(`[${i}] 基线 ${a.min}..${a.max} → 现在 ${b.min}..${b.max}`);
      }
    }
    console.log(`\n槽 ${slot}（记录起点 ${off}，死区 0→99）：${lines.length ? lines.join("  ") : "输入无变化"}`);
    writeConfig(cfgDev, base);
    await sleep(200);
  }
} finally {
  cfgDev.close();
  inDev.close();
}
