/**
 * 508B 语义模型 —— 只暴露「真机验证过」的字段。
 *
 * 原则：
 *  1. 读写都以「整份 508B + 字节偏移」为唯一真相，UI 不持有第二份语义状态；
 *  2. 写回时**只覆盖被编辑的字节**，其余字节从设备原值逐字节保留
 *     （有些字节写错会让设备掉线，必须原样回传）；
 *  3. CRC-16/MODBUS 在 [0..1]，每次写回前重算。
 *
 * 字段来源见 508B-FIELD-MAP-v39.md §9–§15。
 */
import {
  computePayloadChecksum, crc16Modbus, evalCurvePoints, applyJoystickCurve,
} from "../../../bbw-protocol/src/write-format.js";

export const SIZE = 508;
export const FULL_SCALE = 32767;

/** 摇杆曲线槽：槽 0 = 左摇杆，槽 1 = 右摇杆（槽 2..5 本机型不生效） */
export const STICK_SLOT = {
  left: { base: 14, name: "左摇杆" },
  right: { base: 62, name: "右摇杆" },
};
export const SLOT_SIZE = 48;

/** 体感 sim_keys 枚举（反编译表：枚举号 → dword 位掩码） */
export const SIM_KEYS = [
  { id: 0, mask: 0x40 }, { id: 1, mask: 0x100 }, { id: 2, mask: 0x80 }, { id: 3, mask: 0x200 },
  { id: 4, mask: 0x1 }, { id: 5, mask: 0x2 }, { id: 6, mask: 0x8 }, { id: 7, mask: 0x10 },
  { id: 8, mask: 0x800000 }, { id: 9, mask: 0x1000000 }, { id: 10, mask: 0x2000000 },
  { id: 11, mask: 0x4000000 }, { id: 12, mask: 0x10000 }, { id: 13, mask: 0x20000 },
  { id: 14, mask: 0x40000 }, { id: 15, mask: 0x80000 }, { id: 16, mask: 0x2000 },
  { id: 17, mask: 0x4000 }, { id: 18, mask: 0x8000 }, { id: 19, mask: 0x400 },
  { id: 20, mask: 0x800 },
];
/** 真机验证过的按键名（只有 A 键 100% 确认，其余按反编译枚举保留占位） */
export const SIM_KEY_LABEL = { 9: "A" };
export const simKeyName = (id) => SIM_KEY_LABEL[id] ?? `枚举 ${id}`;

export const MOTION_MODE = { 0: "关闭", 1: "模拟左摇杆", 2: "模拟右摇杆" };
export const RESPOND = { 0: "常开", 1: "按下触发" };

/* ---------------------------------------------------------------- 读 */

export function readModel(payload) {
  const p = payload;
  const u8 = (o) => p[o] ?? 0;
  const crcOk = p[0] === (computePayloadChecksum(p) >> 8) && p[1] === (computePayloadChecksum(p) & 0xff);

  const sticks = {};
  for (const [key, { base }] of Object.entries(STICK_SLOT)) {
    sticks[key] = {
      base,
      deadzone: u8(base + 2),
      points: Array.from({ length: 5 }, (_, i) => ({ in: u8(base + 4 + i * 2), out: u8(base + 5 + i * 2) })),
      mark: u8(base + 14),
    };
  }

  const simBits = (u8(305) | (u8(306) << 8) | (u8(307) << 16) | (u8(308) << 24)) >>> 0;
  const mode = u8(304);
  const axis = u8(311);

  return {
    crcOk,
    crc: (p[0] << 8) | p[1],
    header: [p[2], p[3]],
    hire: { left: !!(u8(4) & 1), right: !!(u8(4) & 2) },
    trigger: {
      left: { low: u8(5), high: 100 - u8(6) },
      right: { low: u8(7), high: 100 - u8(8) },
    },
    flags: { f12: u8(12), f13: u8(13) },
    /** [13] 物理摇杆轴反转（§13 真机验证：bit0/1 左 X/Y，bit4/5 右 X/Y） */
    stickInvert: {
      leftX: !!(u8(13) & 0x01),
      leftY: !!(u8(13) & 0x02),
      rightX: !!(u8(13) & 0x10),
      rightY: !!(u8(13) & 0x20),
    },
    sticks,
    motion: {
      byte304: mode,
      mode: mode & 0x0f,
      respond: mode >> 4,
      simBits,
      simKeyIds: SIM_KEYS.filter((k) => simBits & k.mask).map((k) => k.id),
      // [311] 的位布局随 [304] 低半字节变化（反编译：mode 1 → bit1/bit2，mode 2 → bit3/bit4）
      invertX: !!(axis & ((mode & 0x0f) === 2 ? 0x08 : 0x02)),
      invertY: !!(axis & ((mode & 0x0f) === 2 ? 0x10 : 0x04)),
      byte311: axis,
    },
    shock: {
      grade: u8(360),
      params: Array.from(p.subarray(352, 360)),
    },
    keyEnable: (u8(344) | (u8(345) << 8) | (u8(346) << 16) | (u8(347) << 24)) >>> 0,
    keySlots: Array.from({ length: 32 }, (_, i) => ({
      index: i,
      type: u8(380 + i * 4),
      bytes: [u8(381 + i * 4), u8(382 + i * 4), u8(383 + i * 4)],
    })),
  };
}

/* ---------------------------------------------------------------- 写 */

/**
 * 在 payload 副本上按需写字段，并重算 CRC。
 * @param {Uint8Array} payload 基线（设备原值或上次读回值）
 * @param {object} edits 只写出现的键，未出现的字节一律不动
 * @returns {Uint8Array}
 */
export function writeModel(payload, edits = {}) {
  const p = Uint8Array.from(payload);

  if (edits.hire) {
    let v = p[4] & ~0b11;
    if (edits.hire.left) v |= 1;
    if (edits.hire.right) v |= 2;
    p[4] = v;
  }
  if (edits.trigger) {
    const { left, right } = edits.trigger;
    if (left) {
      if (left.low !== undefined) p[5] = clamp(left.low, 0, 100);
      if (left.high !== undefined) p[6] = 100 - clamp(left.high, 0, 100);
    }
    if (right) {
      if (right.low !== undefined) p[7] = clamp(right.low, 0, 100);
      if (right.high !== undefined) p[8] = 100 - clamp(right.high, 0, 100);
    }
  }
  if (edits.sticks) {
    for (const [key, s] of Object.entries(edits.sticks)) {
      const base = STICK_SLOT[key]?.base;
      if (base === undefined) continue;
      if (s.deadzone !== undefined) p[base + 2] = clamp(s.deadzone, 0, 100);
      if (s.points) {
        s.points.slice(0, 5).forEach((pt, i) => {
          if (pt.in !== undefined) p[base + 4 + i * 2] = clamp(pt.in, 0, 100);
          if (pt.out !== undefined) p[base + 5 + i * 2] = clamp(pt.out, 0, 100);
        });
      }
    }
  }
  if (edits.stickInvert) {
    const s = edits.stickInvert;
    let v = p[13];
    const set = (bit, on) => { v = on ? (v | bit) : (v & ~bit); };
    if (s.leftX !== undefined) set(0x01, s.leftX);
    if (s.leftY !== undefined) set(0x02, s.leftY);
    if (s.rightX !== undefined) set(0x10, s.rightX);
    if (s.rightY !== undefined) set(0x20, s.rightY);
    p[13] = v;
  }
  if (edits.motion) {
    const m = edits.motion;
    let mode = p[304];
    if (m.mode !== undefined) mode = (mode & 0xf0) | (m.mode & 0x0f);
    if (m.respond !== undefined) mode = (mode & 0x0f) | ((m.respond & 0x0f) << 4);
    p[304] = mode;

    if (m.simKeyIds) {
      let bits = 0;
      for (const id of m.simKeyIds) {
        const e = SIM_KEYS.find((k) => k.id === id);
        if (e) bits = (bits | e.mask) >>> 0;
      }
      p[305] = bits & 0xff;
      p[306] = (bits >>> 8) & 0xff;
      p[307] = (bits >>> 16) & 0xff;
      p[308] = (bits >>> 24) & 0xff;
    }
    if (m.invertX !== undefined || m.invertY !== undefined) {
      // 反转位随模拟目标切换：左摇杆 bit1/bit2，右摇杆 bit3/bit4
      const right = (mode & 0x0f) === 2;
      const bx = right ? 0x08 : 0x02;
      const by = right ? 0x10 : 0x04;
      let a = p[311];
      if (m.invertX !== undefined) a = m.invertX ? a | bx : a & ~bx;
      if (m.invertY !== undefined) a = m.invertY ? a | by : a & ~by;
      p[311] = a;
    }
  }
  if (edits.keySlot) {
    const { index, type, bytes } = edits.keySlot;
    if (index >= 0 && index < 32) {
      const off = 380 + index * 4;
      p[off] = type & 0xff;
      p[off + 1] = bytes?.[0] ?? 0;
      p[off + 2] = bytes?.[1] ?? 0;
      p[off + 3] = bytes?.[2] ?? 0;
    }
  }
  if (edits.keyEnable) {
    const { slot, on } = edits.keyEnable;
    let bits = (p[344] | (p[345] << 8) | (p[346] << 16) | (p[347] << 24)) >>> 0;
    bits = on ? (bits | (1 << slot)) >>> 0 : (bits & ~(1 << slot)) >>> 0;
    p[344] = bits & 0xff;
    p[345] = (bits >>> 8) & 0xff;
    p[346] = (bits >>> 16) & 0xff;
    p[347] = (bits >>> 24) & 0xff;
  }
  if (edits.shock) {
    const s = edits.shock;
    if (s.grade !== undefined) p[360] = s.grade & 0xff;
    if (s.params) s.params.slice(0, 8).forEach((v, i) => { p[352 + i] = v & 0xff; });
  }

  const cs = computePayloadChecksum(p);
  p[0] = (cs >> 8) & 0xff;
  p[1] = cs & 0xff;
  return p;
}

export function extendCrc(payload) {
  const p = Uint8Array.from(payload);
  const cs = computePayloadChecksum(p);
  p[0] = (cs >> 8) & 0xff;
  p[1] = cs & 0xff;
  return p;
}

export { crc16Modbus, computePayloadChecksum, evalCurvePoints, applyJoystickCurve };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));

/* ---------------------------------------------------------------- 展示 */

/** 摇杆处理链：径向死区 → 5 点分段线性 → 输出模长（§12） */
export function stickCurveFn(stick) {
  return (lx, ly) => applyJoystickCurve({ deadzoneCenter: stick.deadzone, points: stick.points }, lx, ly);
}

/** 采样一条曲线，供图表绘制（输入 0..100 → 输出 0..100） */
export function sampleCurve(stick, n = 48) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * 100;
    out.push({ x, y: evalCurvePoints(stick.points, x) });
  }
  return out;
}

/** 差异字节（调试页用） */
export function diffPayload(a, b) {
  if (!a || !b) return [];
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push({ off: i, from: a[i], to: b[i] });
  return out;
}
