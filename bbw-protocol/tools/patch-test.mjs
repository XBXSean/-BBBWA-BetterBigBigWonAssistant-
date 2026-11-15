#!/usr/bin/env node
/**
 * patch-test.mjs —— 任意补丁 → XInput 差分测量
 *
 * 用法:
 *   node tools/patch-test.mjs --patch "18=255,19=255" [--ms 260] [--settle 150]
 *   node tools/patch-test.mjs --patch "18=255,19=255" --patch "18=0,19=0"   多组依次测
 *
 * 每组：写补丁 → 采样 → 还原 → 采样(校验)。全程拒触震动区段 [352..360]。
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
const patcheSpecs = [];
for (let i = 0; i < argv.length; i++) if (argv[i] === "--patch") patcheSpecs.push(argv[i + 1]);
const MS = Number(getArg("--ms", "260"));
const SETTLE = Number(getArg("--settle", "150"));

if (!patcheSpecs.length) { console.error("需要 --patch \"18=255,19=255\""); process.exit(1); }

const patches = patcheSpecs.map((spec) => {
  const o = {};
  for (const kv of spec.split(",").filter(Boolean)) {
    const [k, v] = kv.split("=").map((s) => s.trim());
    const off = Number(k), val = Number(v);
    if (!Number.isInteger(off) || !Number.isInteger(val) || val < 0 || val > 255) {
      throw new Error(`非法补丁项: ${kv}`);
    }
    if (off >= SHOCK_LO && off <= SHOCK_HI) throw new Error(`拒绝：偏移 ${off} 在震动区段`);
    o[off] = val;
  }
  return { spec, o };
});

function openConfig() {
  const d = hidDevices().find((x) => x.vendorId === VID && x.productId === PID &&
    (x.usagePage ?? x.usage_page) === CONFIG_UP);
  if (!d) throw new Error("找不到配置通道(MI_02 / 0xFF7A)");
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
function sample(ms) {
  const r = spawnSync("python", ["tools/xinput-sample.py", "--ms", String(ms)], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || "xinput 采样失败");
  const j = JSON.parse(r.stdout.trim().split("\n").pop());
  if (j.error) throw new Error(j.error);
  return j;
}
// 优先用中位数:皮筋/手抖会产生偶发跳变,(min+max)/2 会被单个异常值带偏
const mid = (s) => (typeof s.med === "number" ? s.med : (s.min + s.max) / 2);

const dev = openConfig();
try {
  const base = readConfig(dev);
  console.log(`基线 ${base.length}B CRC 自洽=${parseWritePayload(base).checksumOk}`);
  const b0 = sample(400);
  console.log(`基线 LT=${mid(b0.lt)} RT=${mid(b0.rt)}\n`);

  const rows = [];
  for (const { spec, o } of patches) {
    const p = Uint8Array.from(base);
    for (const [k, v] of Object.entries(o)) p[Number(k)] = v;
    writeConfig(dev, p);
    await sleep(SETTLE);
    const s = sample(MS);
    writeConfig(dev, base);
    await sleep(SETTLE);
    rows.push({
      补丁: spec,
      LT: mid(s.lt), RT: mid(s.rt),
      LX: mid(s.lx), LY: mid(s.ly), RX: mid(s.rx), RY: mid(s.ry),
      ΔLT: mid(s.lt) - mid(b0.lt), ΔRT: mid(s.rt) - mid(b0.rt),
      ΔLX: mid(s.lx) - mid(b0.lx), ΔLY: mid(s.ly) - mid(b0.ly),
      ΔRX: mid(s.rx) - mid(b0.rx), ΔRY: mid(s.ry) - mid(b0.ry),
    });
  }
  console.table(rows);

  const back = readConfig(dev);
  const diff = [];
  for (let i = 0; i < 508; i++) if (back[i] !== base[i]) diff.push(i);
  console.log(`结束：${diff.length ? "还原差异 " + diff.join(",") : "已完整还原 ✅"}`);

  // 位置漂移守卫:整轮跑十几秒,皮筋/手可能滑,漂移会伪装成"参数有效"
  const b1 = sample(400);
  const drift = ["lx", "ly", "rx", "ry"].map((k) => ({
    轴: k.toUpperCase(),
    起始: mid(b0[k]),
    结束: mid(b1[k]),
    漂移: Math.round(mid(b1[k]) - mid(b0[k])),
  }));
  const worst = Math.max(...drift.map((r) => Math.abs(r.漂移)));
  console.table(drift);
  console.log(worst > 900
    ? `⚠ 位置漂移 ${worst} 计数，超过阈值 900，本轮结果不可信`
    : `漂移 ${worst} 计数（阈值 900），位置稳定 ✅`);
} finally { dev.close(); }
