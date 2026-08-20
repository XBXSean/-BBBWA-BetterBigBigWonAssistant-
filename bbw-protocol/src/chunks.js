/**
 * 64B HID 报告分块 —— 真实帧格式(经 USB 抓包验证)
 *
 * ✅ 真机抓包确认:
 *
 * 帧格式(每包 64B):
 *   [0] = 0xA4 固定魔数
 *   [1] = 有效长度 (满块 0x40=64;末块 0x29=41)
 *   [2] = marker: 0xD7 = 软件写入 / 0xD6 = 设备读回
 *   [3] = 块序号 01..09
 *   [4..62] = 数据(59B,满块)
 *   [63]    = 帧校验字节(满块)
 *
 * 帧校验字节 = sum(本帧校验字节之前所有字节) mod 256:
 *   块 1-8:frame[63] = sum(frame[0..62]) mod 256
 *   块 9:  frame[40] = sum(frame[0..39]) mod 256 (末块数据 36B)
 * 验证:270/270 帧全部匹配;读回(marker d6)校验 = 写入(d7)校验 - 1,与公式吻合。
 *
 * 数据流 = 8×59 + 36 = 508B(校验字节不在数据流内!):
 *   块 k 数据 = frame[4..62](59B)/ 末块 frame[4..39](36B)。
 *   注意:这与"456B 读 pad set"不同构,是另一套序列化(write-format.js)。
 *
 * 读配置流程:
 *   发送 64B 查询帧 a5 04 d6 7f 00... → 设备回 9×64B 帧(a4 40 d6 01..09),
 *   重组得到 508B 数据流。
 */
import { PAYLOAD_SIZE } from "./write-format.js";

export const REPORT_SIZE = 64; // 实际传输 64B
export const FRAME_HEADER = 4; // [0..3]
export const BLOCK_FULL = 59;  // 满块数据字节数(64 - 4 - 1 校验)
export const BLOCK_LAST = 36;  // 末块数据字节数(41 - 4 - 1 校验)
export const CHUNK_COUNT = 9;  // 每轮 9 块(seq 01..09)
export const PAYLOAD_SIZE_VERIFIED = BLOCK_FULL * 8 + BLOCK_LAST; // 508

export const MAGIC_WRITE = 0xa4;
export const MARKER_WRITE = 0xd7; // 软件 → 设备
export const MARKER_READ = 0xd6;  // 设备 → 软件(读回)

/** 读配置查询帧(64B,固定):a5 04 d6 7f + 60×00 */
export const READ_QUERY = (() => {
  const f = new Uint8Array(REPORT_SIZE);
  f[0] = 0xa5;
  f[1] = 0x04;
  f[2] = 0xd6;
  f[3] = 0x7f;
  return f;
})();

/**
 * 计算帧校验字节(验证通过):sum(本帧校验字节之前所有字节) mod 256。
 * @param {Uint8Array} frame 64B 帧
 * @param {number} checkPos 校验字节位置(满块 63,末块 40)
 */
export function computeFrameChecksum(frame, checkPos) {
  let sum = 0;
  for (let i = 0; i < checkPos; i++) sum = (sum + frame[i]) & 0xff;
  return sum;
}

/** 由帧长度([1])推断校验字节位置 */
export function checkPosOf(frame) {
  return frame[1] === 64 ? 63 : FRAME_HEADER + (frame[1] - FRAME_HEADER) - 1;
}

/**
 * 组装一帧(64B),自动填充校验字节。
 * @param {number} marker MARKER_WRITE | MARKER_READ
 * @param {number} seq 块序号 1..9
 * @param {Uint8Array} block 本块数据(满块 59B,末块 ≤36B)
 * @returns {Uint8Array} 64B 帧
 */
export function buildFrame(marker, seq, block) {
  const frame = new Uint8Array(REPORT_SIZE);
  frame[0] = MAGIC_WRITE;
  frame[1] = FRAME_HEADER + block.length + 1; // 4 + 数据 + 1 校验
  frame[2] = marker;
  frame[3] = seq;
  frame.set(block, FRAME_HEADER);
  const checkPos = checkPosOf(frame);
  frame[checkPos] = computeFrameChecksum(frame, checkPos);
  return frame;
}

/**
 * 508B 数据流 → 9×64B 帧(写通道 marker=d7)。
 * @param {Uint8Array} payload ≤508B 数据流
 * @param {number} [marker]
 * @returns {Uint8Array[]}
 */
export function chunkPayload(payload, marker = MARKER_WRITE) {
  const reports = [];
  let offset = 0;
  for (let s = 1; s <= CHUNK_COUNT; s++) {
    const remaining = payload.length - offset;
    const isLast = s === CHUNK_COUNT;
    const cap = isLast ? BLOCK_LAST : BLOCK_FULL;
    const len = Math.max(0, Math.min(remaining, cap));
    const block = new Uint8Array(cap);
    if (len > 0) block.set(payload.subarray(offset, offset + len));
    reports.push(buildFrame(marker, s, block));
    offset += len;
  }
  return reports;
}

/**
 * 9×64B 帧 → 508B 数据流(去 4B 头 + 校验字节;可选校验)。
 * @param {Uint8Array[]} frames
 * @param {{validate?: boolean, marker?: number}} [opts]
 * @returns {Uint8Array}
 */
export function dechunkFrames(frames, opts = {}) {
  const out = [];
  for (const f of frames) {
    if (f[0] !== MAGIC_WRITE) {
      if (opts.validate) throw new Error(`帧魔数错误:0x${f[0]?.toString(16)}`);
      continue;
    }
    if (opts.marker !== undefined && f[2] !== opts.marker) {
      if (opts.validate) throw new Error(`帧 marker 错误:0x${f[2].toString(16)}`);
    }
    if (opts.validate) {
      const cp = checkPosOf(f);
      const c = computeFrameChecksum(f, cp);
      if (c !== f[cp]) throw new Error(`帧校验失败(seq=${f[3]}):${c.toString(16)} != ${f[cp].toString(16)}`);
    }
    const dataLen = f[1] - FRAME_HEADER - 1; // 减去校验字节
    for (let j = 0; j < dataLen; j++) out.push(f[FRAME_HEADER + j]);
  }
  const p = new Uint8Array(out);
  if (p.length !== PAYLOAD_SIZE && opts.validate) {
    throw new Error(`数据流长度异常:${p.length} != ${PAYLOAD_SIZE}`);
  }
  return p;
}

/* ---- 兼容旧导出(内部仍是真实格式) ---- */

/**
 * @deprecated 用 chunkPayload(载荷=序列化后的 508B 数据流)。
 */
export function chunkPadset(padset, opts = {}) {
  const payload = new Uint8Array(PAYLOAD_SIZE);
  payload.set(padset.subarray(0, Math.min(padset.length, PAYLOAD_SIZE)));
  return chunkPayload(payload, opts.marker ?? MARKER_WRITE);
}

/**
 * @deprecated 用 dechunkFrames。
 */
export function dechunkReports(reports) {
  return dechunkFrames(reports);
}

export const computeCrc = computeFrameChecksum; // 旧名(占位 CRC16 → 真实求和校验)
export const CMD = { QUERY_STATUS: 0x04, QUERY_PROFILE: 0x0c };
