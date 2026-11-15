#!/usr/bin/env node
/**
 * 体感参数扫描：固定物理动作（人来回转动手柄）下，逐值写入某字节并记录峰值输出。
 *
 * 体感是动态量（角速度/倾斜），静止时输出恒为 0，所以必须用「峰值」而不是中位数比较：
 * 每个参数值采样一段时间，取各轴 |读数| 的最大值作为该值下的响应幅度。
 *
 * 用法：
 *   node tools/motion-sweep.mjs --offset 316 --values 0,20,40,60 --ms 2500
 *   node tools/motion-sweep.mjs --patch "315=0" --patch "315=10" --ms 2500
 */
import { HID, devices as hidDevices } from "node-hid";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  chunkPayload,
  dechunkFrames,
  READ_QUERY,
  MARKER_READ,
  computePayloadChecksum,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function args(name) {
  const out = [];
  process.argv.forEach((a, i) => {
    if (a === "--" + name && process.argv[i + 1]) out.push(process.argv[i + 1]);
  });
  return out;
}

const MS = Number(arg("ms", "2500"));
const SETTLE = Number(arg("settle", "900"));
const GUARD = arg("guard", "352,353,354,355,356,357,358,359,360");

// 补丁列表：--patch "316=0" 或 --offset 316 --values 0,20,40
const specs = args("patch");
if (!specs.length) {
  const off = arg("offset", null);
  const values = arg("values", null);
  if (off === null || values === null) {
    console.error("用法: --patch \"316=0\" [...] 或 --offset 316 --values 0,20,40");
    process.exit(2);
  }
  for (const v of values.split(",")) specs.push(`${off}=${v.trim()}`);
}

const guardSet = new Set(GUARD.split(",").map((s) => Number(s.trim())));

function findDev() {
  const d = hidDevices().find(
    (x) => x.vendorId === 0x413d && (x.usagePage ?? x.usage_page) === 0xff7a
  );
  if (!d) throw new Error("找不到配置通道 (usagePage 0xFF7A)");
  return d;
}

function makeIo(dev) {
  const send = (f) => {
    try {
      dev.write([0x00, ...f]);
    } catch {
      dev.write([...f]);
    }
  };
  return {
    read() {
      send(READ_QUERY);
      const fr = [];
      const t0 = Date.now();
      while (fr.length < 9 && Date.now() - t0 < 1500) {
        const b = dev.readTimeout(200);
        if (!b || !b.length) continue;
        const f = b.length === 65 ? b.subarray(1) : b;
        if (f[0] === 0xa4) fr.push(Uint8Array.from(f));
      }
      if (fr.length !== 9) throw new Error("读回失败 " + fr.length + "/9");
      return dechunkFrames(fr, { validate: true, marker: MARKER_READ });
    },
    write(p) {
      const q = Uint8Array.from(p);
      const cs = computePayloadChecksum(q);
      q[0] = (cs >> 8) & 0xff;
      q[1] = cs & 0xff;
      for (const f of chunkPayload(q)) send(f);
    },
  };
}

function sample(ms) {
  const r = spawnSync("python", [join(HERE, "xinput-sample.py"), "--ms", String(ms)], {
    encoding: "utf8",
    cwd: join(HERE, ".."),
  });
  const line = (r.stdout || "").trim().split("\n").filter(Boolean).pop() || "{}";
  const d = JSON.parse(line);
  if (d.error || d.samples === undefined) return null;
  const peak = (k) => Math.max(Math.abs(d[k].min), Math.abs(d[k].max));
  return {
    lx: d.lx.med, ly: d.ly.med, rx: d.rx.med, ry: d.ry.med,
    plx: peak("lx"), ply: peak("ly"), prx: peak("rx"), pry: peak("ry"),
  };
}

const dev = new HID(findDev().path);
const io = makeIo(dev);
let base;
try {
  base = io.read();
  console.log(`基线 304=${base[304]} 315=${base[315]} 316=${base[316]} 318=${base[318]} 312=${base[312]}`);

  const rows = [];
  const b0 = sample(MS);
  if (!b0) throw new Error("XInput 读取失败");
  console.log(`基线峰值  |LX|=${b0.plx} |LY|=${b0.ply} |RX|=${b0.prx} |RY|=${b0.pry}`);

  for (const spec of specs) {
    const pairs = spec.split(",").map((s) => {
      const [k, v] = s.split("=").map((x) => Number(x.trim()));
      if (guardSet.has(k)) throw new Error(`偏移 ${k} 在震动区段，拒绝写入`);
      return [k, v];
    });
    const p = Uint8Array.from(base);
    for (const [k, v] of pairs) p[k] = v;
    io.write(p);
    await sleep(SETTLE);
    const s = sample(MS);
    io.write(base);
    await sleep(SETTLE);
    if (!s) continue;
    rows.push({
      补丁: spec,
      "|LX|": s.plx,
      "|LY|": s.ply,
      "|RX|": s.prx,
      "|RY|": s.pry,
      "Δ|LX|": s.plx - b0.plx,
      "Δ|LY|": s.ply - b0.ply,
    });
  }
  console.table(rows);

  await sleep(400);
  const back = io.read();
  const diff = [];
  for (let i = 0; i < 508; i++) if (back[i] !== base[i]) diff.push(i);
  console.log(diff.length ? "⚠ 还原差异 " + diff.join(",") : "配置已完整还原 ✅");
} finally {
  dev.close();
}
