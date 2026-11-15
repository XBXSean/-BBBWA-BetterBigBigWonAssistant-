#!/usr/bin/env node
/**
 * deadzone-scan.mjs —— 扫头部扳机死区字节 [4..9]，对固定行程读 XInput
 *
 * 假设（来自 write-format.js 的解析）：
 *   [5] = LT 低死区(百分比)
 *   [6] = 100 - LT 高死区  →  leftHigh = 100 - [6]
 *   [7] = RT 低死区
 *   [8] = 100 - RT 高死区
 * 判据：若假设成立，[5] 扫高时 LT 掉到 0；[6] 扫高时 LT 跳到 255（方向相反）。
 *       [7]/[8] 对 LT 无影响（阴性对照）。
 *
 * 用法：node tools/deadzone-scan.mjs [--offsets 5,6] [--ms 280]
 * 全程不触碰震动区段 [352..360]，结束写回基线。
 */
import { HID, devices as hidDevices } from "node-hid";
import { spawnSync } from "node:child_process";
import {
  chunkPayload, dechunkFrames, READ_QUERY, MARKER_READ,
  computePayloadChecksum, parseWritePayload,
} from "../src/index.js";

const VID = 0x413d;
const PID = 0x2104;
const CONFIG_UP = 0xff7a;
const SHOCK_LO = 352;
const SHOCK_HI = 360;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const getArg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const SCAN_MS = Number(getArg("--ms", "280"));
const OFFSETS = getArg("--offsets", "5,6").split(",").map((s) => Number(s.trim()));
const VALUES = [0, 10, 20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 100];

for (const o of OFFSETS) {
  if (o >= SHOCK_LO && o <= SHOCK_HI) {
    console.error(`拒绝：偏移 ${o} 在震动区段 [${SHOCK_LO}..${SHOCK_HI}]`);
    process.exit(1);
  }
}

function openConfig() {
  const d = hidDevices().find((x) => x.vendorId === VID && x.productId === PID &&
    (x.usagePage ?? x.usage_page) === CONFIG_UP);
  if (!d) throw new Error("找不到配置通道(MI_02 / 0xFF7A)");
  return new HID(d.path);
}
const sendReport = (dev, f) => { try { dev.write([0x00, ...f]); } catch { dev.write([...f]); } };

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
function sample(ms) {
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
  console.log(`基线 ${base.length}B CRC 自洽=${parseWritePayload(base).checksumOk}`);
  console.log(`头部 [4..9] = ${[...base.subarray(4, 10)].join(" ")}`);

  const b0 = sample(400);
  console.log(`基线读数 LT=${mid(b0.lt)} RT=${mid(b0.rt)}  (行程 ${(mid(b0.lt) / 255 * 100).toFixed(1)}%)`);
  if (b0.lt.min !== b0.lt.max) {
    console.log(`⚠ 读数在漂移(${b0.lt.min}..${b0.lt.max})，请把手稳住再跑`);
  }

  const results = [];
  for (const off of OFFSETS) {
    for (const v of VALUES) {
      const p = Uint8Array.from(base);
      p[off] = v;
      writeConfig(dev, p);
      await sleep(150);
      const s = sample(SCAN_MS);
      results.push({
        字节: off, 写入: v, 原值: base[off],
        LT: mid(s.lt), RT: mid(s.rt),
        ΔLT: mid(s.lt) - mid(b0.lt),
      });
    }
    // 每组结束立即还原，避免中途状态残留
    writeConfig(dev, base);
    await sleep(150);
    const chk = sample(300);
    console.log(`  [${off}] 组还原校验 LT=${mid(chk.lt)}（基线 ${mid(b0.lt)}）`);
  }

  console.table(results);

  // 汇总方向性
  console.log("\n=== 方向性判定 ===");
  for (const off of OFFSETS) {
    const rs = results.filter((r) => r.字节 === off);
    const down = rs.filter((r) => r.ΔLT < -8).length;
    const up = rs.filter((r) => r.ΔLT > 8).length;
    console.log(`[${off}] 压低次数=${down} 抬高次数=${up} → ${down > up ? "低死区(越大越压)" : up > down ? "高死区(越大越抬)" : "无影响"}`);
  }

  writeConfig(dev, base);
  await sleep(150);
  const back = readConfig(dev);
  const diff = [];
  for (let i = 0; i < 508; i++) if (back[i] !== base[i]) diff.push(i);
  console.log(`\n结束：${diff.length ? "还原差异 " + diff.join(",") : "已完整还原基线 ✅"}`);
} finally {
  dev.close();
}
