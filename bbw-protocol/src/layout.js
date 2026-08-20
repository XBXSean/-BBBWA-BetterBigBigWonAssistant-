/**
 * 设备 pad set 结构布局(v61,456 字节)
 *
 * 说明:所有偏移为设备结构字节偏移;带 TODO 的项语义未经真机验证,
 * 其余为已验证的硬映射。
 */

/**
 * 注:读方向结构名义上为 454B,但灯效区在 +328 且长度 128B,
 * 故结构实际 ≥ 456B。以 456 为准。
 */
export const PADSET_SIZE = 456;

export const OFF = {
  /** 头区(130B,+4..+133) */
  hwMode: 4, // byte: 位标志 (bit0 = L-hire, bit1 = R-hire)
  dz: { c0: 5, s0: 6, c1: 7, s1: 8 }, // 死区 L/R; s 存 100-x 补码
  featFlags1: 12, // byte: 功能位
  featFlags2: 13, // byte: 功能位
  /** 6 个扳机槽,各 14B */
  triggerSlots: [14, 28, 42, 56, 70, 84],

  /** 体感区 */
  motionMode: 100, // byte = sensorMode*16 + enumSensorMode
  simKeys: 101, // dword(LE) 位图:体感模拟摇杆键
  axisFlags: 107, // byte: 轴反转/模式位
  gyro: { d: 108, b: 111, c: 112, a: 114 },

  /** 摇杆 */
  joystickDeadzone: 135, // 2B (打包: [0]=clamp(app+2,0,255), [1]=clamp(100-app+13,0,255))
  joystickRegion: 149, // 36B 摇杆区

  /** 键位 */
  keymapEnable: 140, // dword(LE) 位图:按键使能
  keyActions: 144, // 键动作参数区
  keymapRegion: 197, // 65B ([0]=0x5A 魔数)
  keyEntries: 207, // 128B = 32 × 4B 条目

  /** 震动 */
  shock: {
    layoutA: [181, 185, 182, 186], // 4 参数 (设备型号 A)
    layoutB: [179, 183, 180, 184], // 4 参数 (设备型号 B)
  },
  motorIndex: 187, // byte: 电机档位

  /** 宏 */
  macroRegion: 262, // 66B ([0]=0xD8 魔数, [1]=数量)

  /** 灯效/大块 */
  lightRegion: 328, // 128B
};

/** 扳机槽内字段偏移(14B) */
export const TRIGGER_SLOT = {
  mode: 0,
  param1: 1,
  c: 2, // clamp(0..100)
  s: 3, // clamp(0..100)
  curve: 4, // 8 字节响应曲线(clamp -128..127)
  thresholdA: 12, // clamp(100-v, 0, 100)
  thresholdB: 13, // clamp(100-v, 0, 100)
};
export const TRIGGER_SLOT_SIZE = 14;

/** sim_keys 位图:键值 0..20 → 位掩码 */
export const SIM_KEY_BITS = {
  0: 0x40, 1: 0x100, 2: 0x80, 3: 0x200, 4: 0x1, 5: 0x2, 6: 0x8,
  7: 0x10, 8: 0x800000, 9: 0x1000000, 10: 0x2000000, 11: 0x4000000,
  12: 0x10000, 13: 0x20000, 14: 0x40000, 15: 0x80000, 16: 0x2000,
  17: 0x4000, 18: 0x8000, 19: 0x400, 20: 0x800,
};

/** 键值 → 槽位掩码(简化实现,骨架占位) */
export function keyBit(keyValue) {
  // TODO(validate): 还原键值→位掩码映射(尚未真机验证完整)
  if (keyValue < 0) return 0;
  return 1 << Math.min(keyValue, 31);
}

export function clampInt(v, lo, hi) {
  v = Math.trunc(Number(v) || 0);
  return Math.max(lo, Math.min(hi, v));
}

export function writeU32(buf, off, v) {
  buf[off] = v & 0xff;
  buf[off + 1] = (v >>> 8) & 0xff;
  buf[off + 2] = (v >>> 16) & 0xff;
  buf[off + 3] = (v >>> 24) & 0xff;
}

export function readU32(buf, off) {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}
