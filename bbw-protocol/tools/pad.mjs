#!/usr/bin/env node
/**
 * pad.mjs —— 墨将手柄「无头」配置测试台
 *
 * 设计前提(全部来自已落盘的真值,不依赖任何转录样本):
 * - 配置通道: VID 0x413D / PID 0x2104 / MI_02 / usagePage 0xFF7A / 64B 报告(ID 0)
 * - 读: 发 a5 04 d6 7f(64B) → 收 a4 <len> d6 <seq> × 9
 * - 写: a4 <len> d7 <seq> + 载荷(9×64B,共 508B 数据流)
 *
 * 震动安全:
 * - 本工具**不实现**任何震动测试命令,代码里不存在能触发马达的调用路径
 * - 写配置时若 [352..360](震动参数 + 档位)与基线不同,直接拒绝,除非显式 --allow-shock
 * - 写前的载荷必须过 CRC 自校验,自己都算不对的载荷不发
 */
import { HID, devices as hidDevices } from "node-hid";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  chunkPayload, dechunkFrames, READ_QUERY, MARKER_READ,
  PAYLOAD_SIZE, parseWritePayload, serializeProfile, computePayloadChecksum,
} from "../src/index.js";

const VID = 0x413d;
const PID = 0x2104;
const CONFIG_USAGE_PAGE = 0xff7a;
const SHOCK_RANGE = [352, 360]; // 含两端
const REPORT = 64;

/* ---------------- 设备 ---------------- */

function usagePageOf(d) {
  return d.usagePage ?? d.usage_page ?? d.usage;
}

function listDevices() {
  return hidDevices().filter((d) => d.vendorId === VID && d.productId === PID);
}

function openConfig() {
  const all = listDevices();
  if (!all.length) {
    throw new Error(
      `没找到 VID=${VID.toString(16)} PID=${PID.toString(16)} 的手柄。\n` +
      `请确认:① 手柄已用 USB 线连电脑并开机 ② 官方助手已完全退出(它会独占设备)`,
    );
  }
  const pick = all.find((d) => usagePageOf(d) === CONFIG_USAGE_PAGE);
  if (!pick) {
    console.error("枚举到的接口:");
    for (const d of all) console.error("  ", JSON.stringify(d));
    throw new Error("没有 usagePage 0xFF7A 的配置通道接口");
  }
  return { dev: new HID(pick.path), info: pick };
}

/* ---------------- 收发 ---------------- */

/** node-hid 在 Windows 上要求首字节为 report ID;报告 ID 为 0 时补一个 0x00 */
function sendReport(dev, frame) {
  const buf = [...frame];
  try {
    dev.write([0x00, ...buf]);
  } catch {
    dev.write(buf); // 部分 HIDAPI 构建要求不含 report ID
  }
}

function readReports(dev, expect = 9, timeoutMs = 1500) {
  const frames = [];
  const t0 = Date.now();
  while (frames.length < expect && Date.now() - t0 < timeoutMs) {
    const b = dev.readTimeout(200);
    if (!b || !b.length) continue;
    const f = b.length === REPORT + 1 ? b.subarray(1) : b; // 去掉 report ID
    if (f[0] !== 0xa4) continue;
    frames.push(Uint8Array.from(f));
  }
  return frames;
}

/** 读回 508B 数据流 */
function readPayload(dev) {
  sendReport(dev, READ_QUERY);
  const frames = readReports(dev, 9, 1500);
  if (frames.length < 9) throw new Error(`只收到 ${frames.length}/9 帧,设备没响应或通道不对`);
  const bad = frames.filter((f) => f[2] !== MARKER_READ);
  if (bad.length) throw new Error(`有 ${bad.length} 帧 marker 不是 0xd6(收到 0x${bad[0][2].toString(16)})`);
  return dechunkFrames(frames, { validate: true, marker: MARKER_READ });
}

/** 写入 508B 数据流 */
function writePayload(dev, payload) {
  const frames = chunkPayload(payload);
  for (const f of frames) sendReport(dev, f);
}

/* ---------------- 工具 ---------------- */

function hexdump(b, perLine = 32) {
  const lines = [];
  for (let i = 0; i < b.length; i += perLine) {
    const slice = [...b.subarray(i, i + perLine)]
      .map((x) => x.toString(16).padStart(2, "0")).join(" ");
    lines.push(`${String(i).padStart(3, "0")}: ${slice}`);
  }
  return lines.join("\n");
}

function diffBytes(a, b) {
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) out.push({ off: i, from: a[i], to: b[i] });
  }
  return out;
}

function summarizeDiff(cur, next) {
  const d = diffBytes(cur, next);
  if (!d.length) return "无差异";
  return d.map((x) => `[${x.off}] ${x.from}→${x.to}`).join("  ");
}

function assertSafeToWrite(base, next, allowShock) {
  const cs = computePayloadChecksum(next);
  if (next[0] !== ((cs >> 8) & 0xff) || next[1] !== (cs & 0xff)) {
    throw new Error(
      `载荷 CRC 自校验失败(算得 0x${cs.toString(16)},载荷写的是 0x${(next[0] << 8) | next[1]}),拒绝下发`,
    );
  }
  if (!base || allowShock) return;
  for (let i = SHOCK_RANGE[0]; i <= SHOCK_RANGE[1]; i++) {
    if (base[i] !== next[i]) {
      throw new Error(
        `载荷改动了震动区段 [${SHOCK_RANGE[0]}..${SHOCK_RANGE[1]}]([${i}] ${base[i]}→${next[i]})。\n` +
        `默认拒绝以免意外启动马达;确需改动请加 --allow-shock`,
      );
    }
  }
}

function savePayload(dir, payload, tag) {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const binPath = join(dir, `${tag}-${stamp}.bin`);
  const hexPath = join(dir, `${tag}-${stamp}.hex`);
  writeFileSync(binPath, payload);
  writeFileSync(hexPath, hexdump(payload) + "\n");
  return { binPath, hexPath };
}

function loadPayload(file) {
  const raw = readFileSync(file);
  if (raw.length === PAYLOAD_SIZE) return new Uint8Array(raw);
  // 兼容文本 hex 转储
  const m = raw.toString("utf8").match(/0x?[0-9a-f]{2}\b/gi);
  if (!m) throw new Error(`${file} 既不是 ${PAYLOAD_SIZE}B 二进制也不是 hex 文本`);
  const b = Uint8Array.from(m.map((x) => parseInt(x.replace(/^0x/i, ""), 16)));
  if (b.length < PAYLOAD_SIZE) throw new Error(`${file} 解析出 ${b.length}B,不足 ${PAYLOAD_SIZE}`);
  return b.subarray(0, PAYLOAD_SIZE);
}

/* ---------------- 子命令 ---------------- */

function cmdList() {
  const cands = listDevices();
  if (!cands.length) {
    console.log(`未发现 VID=0x${VID.toString(16)} PID=0x${PID.toString(16)} 设备`);
    return;
  }
  for (const d of cands) {
    const up = usagePageOf(d);
    const tag = up === CONFIG_USAGE_PAGE ? "  ← 配置通道" : "";
    console.log(`IF ${String(d.interface).padStart(2)} usagePage=0x${Number(up).toString(16).padStart(4, "0")} ${d.product ?? ""}${tag}`);
  }
}

async function cmdRead(opts) {
  const { dev } = openConfig();
  try {
    const p = readPayload(dev);
    const cfg = parseWritePayload(p);
    console.log(`读回 ${p.length}B  CRC=${Buffer.from(p.subarray(0, 2)).toString("hex")} 自洽=${cfg.checksumOk}`);
    console.log(`header=${cfg.header.map((x) => x.toString(16)).join(" ")}  feat=${cfg.featFlags.map((x) => x.toString(16)).join(" ")}`);
    console.log(`死区 左 ${cfg.triggerDeadzone.leftLow}..${cfg.triggerDeadzone.leftHigh}  右 ${cfg.triggerDeadzone.rightLow}..${cfg.triggerDeadzone.rightHigh}`);
    if (cfg.motion) {
      const m = cfg.motion;
      console.log(`体感 gyro=${m.gyroSens} h2v=${m.h2vRatio} resp=${m.respCurve} dzComp=${m.deadzoneComp} sensorMode=${m.sensorMode} enum=${m.enumSensorMode} axis=${m.axisFlags}`);
    }
    if (cfg.shockParams) {
      console.log(`震动 ${JSON.stringify(cfg.shockParams)}`);
    }
    if (opts.out) {
      const { binPath, hexPath } = savePayload(opts.out, p, "read");
      console.log(`已存 ${binPath}\n     ${hexPath}`);
    }
  } finally { dev.close(); }
}

async function cmdWrite(args, opts) {
  const file = args[0];
  if (!file) throw new Error("用法: pad.mjs write <508B.bin|hex> [--allow-shock] [--dry]");
  const next = loadPayload(file);
  const { dev } = openConfig();
  try {
    let base = null;
    try { base = readPayload(dev); } catch (e) { console.log(`(基线读取失败,跳过震动区段比对:${e.message})`); }
    assertSafeToWrite(base, next, opts.allowShock);
    console.log(`差异: ${base ? summarizeDiff(base, next) : "(无基线)"}`);
    if (opts.dry) { console.log("--dry:不写入"); return; }
    writePayload(dev, next);
    await new Promise((r) => setTimeout(r, 300));
    const back = readPayload(dev);
    const d = diffBytes(next, back);
    console.log(d.length ? `写后回读仍差 ${d.length}B:${summarizeDiff(next, back)}` : "写后回读完全一致 ✅");
  } finally { dev.close(); }
}

/**
 * 逐值扫描某个字节:写入 v → 读回 → 记录设备实际接受/回报的值。
 * 用于测未知参数的量程与钳位行为。
 */
async function cmdSweep(args, opts) {
  const off = Number(args[0]);
  const from = Number(opts.from ?? 0);
  const to = Number(opts.to ?? 255);
  const step = Number(opts.step ?? 1);
  if (!Number.isInteger(off) || off < 4 || off >= PAYLOAD_SIZE) throw new Error("需要合法偏移(--off 或第一个参数)");
  if (off >= SHOCK_RANGE[0] && off <= SHOCK_RANGE[1]) {
    throw new Error(`偏移 ${off} 在震动区段 [${SHOCK_RANGE[0]}..${SHOCK_RANGE[1]}],即使 --allow-shock 也不做扫描`);
  }
  const values = [];
  for (let v = from; v <= to && values.length < 40; v += step) values.push(v);
  if (!opts.yes) {
    console.log(`将向 [${off}] 依次写入 ${values.length} 个值:${values.join(",")}`);
    console.log("每次写入都会持久化到设备。确认无误后加 --yes 执行。");
    return;
  }
  const { dev } = openConfig();
  let base = null;
  try {
    base = readPayload(dev);
    console.log(`基线 [${off}] = ${base[off]}`);
    const rows = [];
    for (const v of values) {
      const p = Uint8Array.from(base);
      p[off] = v;
      // 重算 CRC,否则设备会拒收
      const cs = computePayloadChecksum(p);
      p[0] = (cs >> 8) & 0xff; p[1] = cs & 0xff;
      writePayload(dev, p);
      await new Promise((r) => setTimeout(r, 120));
      const back = readPayload(dev);
      const nbr = [off - 1, off, off + 1].map((i) => i >= 0 ? back[i].toString(16).padStart(2, "0") : "--").join(" ");
      rows.push({ 写入: v, 读回: back[off], "邻域(off-1..off+1)": nbr });
    }
    console.table(rows);
  } finally {
    // 把基线原样写回,避免把手柄留在扫描中间态
    if (base) {
      try {
        const restore = Uint8Array.from(base);
        const cs = computePayloadChecksum(restore);
        restore[0] = (cs >> 8) & 0xff; restore[1] = cs & 0xff;
        writePayload(dev, restore);
        console.log("已写回基线配置");
      } catch (e) { console.error(`基线回写失败:${e.message}`); }
    }
    dev.close();
  }
}

/**
 * 逐字节探测:对每个偏移单独写入一个探针值 → 读回 → 判断该字节是否真的落盘。
 * 每次都从基线重新构造载荷(只改一个字节),结束后写回基线。
 */
async function cmdProbe(args, opts) {
  const offsets = args.map(Number).filter((n) => Number.isInteger(n));
  if (!offsets.length) throw new Error("用法: pad.mjs probe <偏移> [偏移...] [--value 0x5a]");
  const value = opts.value !== undefined ? Number(opts.value) : 0x5a;
  for (const o of offsets) {
    if (o < 4 || o >= PAYLOAD_SIZE) throw new Error(`偏移 ${o} 越界`);
    if (o >= SHOCK_RANGE[0] && o <= SHOCK_RANGE[1]) throw new Error(`偏移 ${o} 在震动区段,不探测`);
  }
  const { dev } = openConfig();
  const base = readPayload(dev);
  console.log(`基线已取:${base.length}B,探针值 0x${value.toString(16)}`);
  const rows = [];
  try {
    for (const o of offsets) {
      const p = Uint8Array.from(base);
      p[o] = value;
      const cs = computePayloadChecksum(p);
      p[0] = (cs >> 8) & 0xff; p[1] = cs & 0xff;
      writePayload(dev, p);
      await new Promise((r) => setTimeout(r, 150));
      const back = readPayload(dev);
      const changed = diffBytes(base, back);
      const self = changed.filter((x) => x.off === o);
      const extra = changed.filter((x) => x.off !== o);
      let verdict;
      if (back[o] === value) verdict = "落盘";
      else if (back[o] === base[o]) verdict = "被忽略(回原值)";
      else verdict = `被改写为 0x${back[o].toString(16)}`;
      rows.push({
        偏移: o,
        基线: `0x${base[o].toString(16).padStart(2, "0")}`,
        读回: `0x${back[o].toString(16).padStart(2, "0")}`,
        判定: verdict,
        连带变化: extra.length ? extra.map((x) => `${x.off}:${x.from}→${x.to}`).join(" ") : "",
      });
    }
  } finally {
    const restore = Uint8Array.from(base);
    const cs = computePayloadChecksum(restore);
    restore[0] = (cs >> 8) & 0xff; restore[1] = cs & 0xff;
    writePayload(dev, restore);
    await new Promise((r) => setTimeout(r, 150));
    const back = readPayload(dev);
    const d = diffBytes(base, back).length;
    console.log(d ? `⚠ 基线回写后仍有 ${d}B 差异` : "基线已原样还原 ✅");
    dev.close();
  }
  console.table(rows);
}

/**
 * 写入一段自定义字节序列 → 读回 → 打印设备实际保存的形态,随后还原基线。
 * 用来破解"写入位置 ≠ 存储位置"的镜像/字节序规则。
 */
async function cmdPoke(args, opts) {
  const off = Number(args[0]);
  const hex = (args[1] ?? "").replace(/0x/gi, "").replace(/[^0-9a-f]/gi, "");
  if (!Number.isInteger(off) || !hex) throw new Error('用法: pad.mjs poke <起始偏移> "11 22 33 44"');
  const bytes = hex.match(/../g).map((h) => parseInt(h, 16));
  const end = off + bytes.length - 1;
  if (off < 4 || end >= PAYLOAD_SIZE) throw new Error("越界");
  if (off <= SHOCK_RANGE[1] && end >= SHOCK_RANGE[0]) throw new Error("触及震动区段,拒绝");

  const { dev } = openConfig();
  const base = readPayload(dev);
  try {
    const p = Uint8Array.from(base);
    bytes.forEach((v, i) => { p[off + i] = v; });
    const cs = computePayloadChecksum(p);
    p[0] = (cs >> 8) & 0xff; p[1] = cs & 0xff;
    writePayload(dev, p);
    await new Promise((r) => setTimeout(r, 200));
    const back = readPayload(dev);
    const rows = [];
    for (let i = off; i <= end; i++) {
      rows.push({
        偏移: i,
        基线: `0x${base[i].toString(16).padStart(2, "0")}`,
        写入: `0x${p[i].toString(16).padStart(2, "0")}`,
        读回: `0x${back[i].toString(16).padStart(2, "0")}`,
      });
    }
    console.table(rows);
    const extra = diffBytes(base, back).filter((x) => x.off < off || x.off > end);
    if (extra.length) console.log(`区段外连带变化:${extra.map((x) => `${x.off}:${x.from}→${x.to}`).join(" ")}`);
  } finally {
    const restore = Uint8Array.from(base);
    const cs = computePayloadChecksum(restore);
    restore[0] = (cs >> 8) & 0xff; restore[1] = cs & 0xff;
    writePayload(dev, restore);
    await new Promise((r) => setTimeout(r, 200));
    const chk = readPayload(dev);
    console.log(diffBytes(base, chk).length ? "⚠ 还原后仍有差异" : "基线已原样还原 ✅");
    dev.close();
  }
}

/**
 * 采集游戏输入报告(IG_00)若干秒,逐字节给出最小值/最大值/最后一个值,
 * 用来做"参数改动 → 输出变化"的差分测量。
 */
async function cmdInput(opts) {
  const seconds = Number(opts.seconds ?? 4);
  const all = listDevices();
  const pad = all.find((d) => usagePageOf(d) === 0x0001 && d.usage === 0x05);
  if (!pad) throw new Error("没找到游戏输入接口(usagePage 1 / usage 5)");
  const dev = new HID(pad.path);
  const stats = [];
  let reports = 0;
  try {
    const t0 = Date.now();
    while (Date.now() - t0 < seconds * 1000) {
      const b = dev.readTimeout(120);
      if (!b || !b.length) continue;
      reports++;
      const data = b.length === 65 || b.length === 16 ? b.subarray(0) : b;
      for (let i = 0; i < data.length; i++) {
        const s = stats[i] ?? (stats[i] = { min: 255, max: 0, last: 0, changed: false });
        if (data[i] < s.min) s.min = data[i];
        if (data[i] > s.max) s.max = data[i];
        if (s.last !== data[i]) s.changed = true;
        s.last = data[i];
      }
    }
  } finally { dev.close(); }
  console.log(`采集 ${seconds}s,收到 ${reports} 份报告,长度 ${stats.length}B`);
  console.table(stats.map((s, i) => ({
    字节: i,
    最小: s.min,
    最大: s.max,
    末值: s.last,
    有变化: s.changed ? "是" : "",
  })));
}

function cmdSelftest() {
  // 离线自检:官方 508B 默认配置 解码→编码→分帧→合帧,必须逐字节还原
  // 默认配置取自官方软件目录下的 DefaultConfig.ini,用 BBW_DEFAULT_INI 指定
  const iniPath = process.env.BBW_DEFAULT_INI
    || ["DefaultConfig.ini", "../DefaultConfig.ini", "../BIGBIG WON/DefaultConfig.ini"].find((p) => existsSync(p));
  if (!iniPath) {
    console.error("未找到 DefaultConfig.ini。请用 BBW_DEFAULT_INI=<路径> 指定官方软件目录下的该文件。");
    process.exit(1);
  }
  const ini = readFileSync(iniPath, "utf8");
  const arr = ini.match(/Rainbow3_508_0x39\s*=\s*\[([^\]]+)\]/i)[1].split(",").map((s) => parseInt(s.trim(), 10));
  const src = Uint8Array.from(arr);
  const cfg = parseWritePayload(src);
  const enc = serializeProfile(cfg, src);
  const frames = chunkPayload(enc);
  const back = dechunkFrames(frames, { validate: true });
  const d1 = diffBytes(src, enc).length;
  const d2 = diffBytes(src, back).length;
  console.log(`官方默认配置 ${src.length}B  CRC 自洽=${cfg.checksumOk}`);
  console.log(`解码→编码 差异 ${d1}B,编码→分帧→合帧 差异 ${d2}B`);
  console.log(`分帧 ${frames.length} 帧,每帧 ${frames[0].length}B(含帧内校验)`);
  if (d1 || d2) { console.error("自检失败"); process.exit(1); }
  console.log("自检通过 ✅");
}

/* ---------------- 入口 ---------------- */

function parseArgs(argv) {
  const args = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) { opts[k] = next; i++; }
      else opts[k] = true;
    } else args.push(a);
  }
  return { args, opts };
}

const [, , cmd, ...rest] = process.argv;
const { args, opts } = parseArgs(rest);

const table = {
  list: cmdList,
  read: () => cmdRead(opts),
  write: () => cmdWrite(args, opts),
  sweep: () => cmdSweep(args, opts),
  probe: () => cmdProbe(args, opts),
  poke: () => cmdPoke(args, opts),
  input: () => cmdInput(opts),
  selftest: () => cmdSelftest(),
};

if (!table[cmd]) {
  console.log(`pad.mjs —— 墨将手柄无头测试台

  node tools/pad.mjs list                         列出接口,标出配置通道
  node tools/pad.mjs selftest                     离线自检(不需要设备)
  node tools/pad.mjs read [--out 目录]             读回 508B 配置并解析
  node tools/pad.mjs write <file> [--dry]         写入(震动区段默认锁死)
  node tools/pad.mjs sweep <偏移> [--from 0 --to 255 --step 1 --yes]
                                                  逐值扫描某字节,读回真实接受值
  node tools/pad.mjs probe <偏移...> [--value 0x5a]  逐字节判断是否落盘(含连带变化)
  node tools/pad.mjs poke <偏移> "11 22 33"        写入任意序列,看设备的存储形态
  node tools/pad.mjs input [--seconds 4]           采集游戏输入报告,看各字节变化
`);
  process.exit(cmd ? 1 : 0);
}

try {
  await table[cmd]();
} catch (e) {
  console.error(`错误:${e.message}`);
  process.exit(1);
}
