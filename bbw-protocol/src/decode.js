/**
 * 设备 pad set(456B)→ 应用 profile 解码
 * 与 encode.js 严格互逆(round-trip 一致性由测试保证)。
 */
import {
  OFF, TRIGGER_SLOT_SIZE, readU32, SIM_KEY_BITS,
} from "./layout.js";
import { decodeTriggerSlot } from "./encode.js";

function decodeMotion(ps) {
  const modeByte = ps[OFF.motionMode];
  const enumMode = modeByte & 0x0f;
  const sensorMode = (modeByte >> 4) & 0x0f;
  const flags = ps[OFF.axisFlags];
  const bits = readU32(ps, OFF.simKeys);
  // TODO(validate): sim_keys 位图多值累积时无法无损还原,此处仅取单键
  let simKey = -1;
  for (const [k, b] of Object.entries(SIM_KEY_BITS)) {
    if (bits === b) { simKey = Number(k); break; }
  }
  const simKeys = simKey >= 0 ? [simKey] : [];

  return {
    gyroA: ps[OFF.gyro.a],
    gyroB: ps[OFF.gyro.b],
    gyroC: ps[OFF.gyro.c],
    gyroD: ps[OFF.gyro.d],
    enumSensorMode: enumMode,
    sensorMode,
    xAxisReversal: enumMode === 1 ? (flags & 0x02 ? 1 : 0) : (flags & 0x08 ? 1 : 0),
    yAxisReversal: enumMode === 1 ? (flags & 0x04 ? 1 : 0) : (flags & 0x10 ? 1 : 0),
    extraFlag: enumMode === 2 ? (flags & 0x01 ? 1 : 0) : 0,
    simKeys,
  };
}

function decodeShock(ps) {
  // 设备型号未知时无法确定布局 A/B;给出两个候选并标记
  const layoutA = OFF.shock.layoutA;
  const layoutB = OFF.shock.layoutB;
  return {
    grade: ps[OFF.motorIndex],
    paramsLayoutA: layoutA.map((o) => ps[o]),
    paramsLayoutB: layoutB.map((o) => ps[o]),
    // TODO(validate): 需要设备型号标志才能确定 params 归属
  };
}

function decodeDeadzone(ps) {
  return {
    c0: ps[OFF.dz.c0],
    s0: 100 - ps[OFF.dz.s0],
    c1: ps[OFF.dz.c1],
    s1: 100 - ps[OFF.dz.s1],
    hire0: ps[OFF.hwMode] & 0x01 ? 1 : 0,
    hire1: ps[OFF.hwMode] & 0x02 ? 1 : 0,
  };
}

function decodeKeys(ps) {
  const enable = readU32(ps, OFF.keymapEnable);
  const keys = [];
  for (let i = 0; i < 32; i++) {
    const entry = OFF.keyEntries + 4 * i;
    const type = ps[entry];
    const code1 = ps[entry + 1];
    const code2 = ps[entry + 2];
    const extra = ps[entry + 3];
    if (type === 0 && code1 === 0 && code2 === 0 && extra === 0) {
      keys.push({ key: -2 });
      continue;
    }
    keys.push({
      key: i, // TODO(validate): 槽位 i 与键值的关系需反向映射确认
      type,
      code1: code1 === 0xff ? -1 : code1,
      code2: code2 === 0xff ? -1 : code2,
      extra,
      action: ps[OFF.keyActions + i],
      enabled: (enable & keyBitFromValue(i)) !== 0,
    });
  }
  return keys;
}

function keyBitFromValue(v) {
  return 1 << Math.min(v, 31);
}

function decodeMacro(ps) {
  const region = OFF.macroRegion;
  if (ps[region] !== 0xd8) return { count: 0, slots: [] };
  const count = ps[region + 1];
  const slots = [];
  for (let m = 0; m < 4; m++) {
    const mac = [];
    for (let j = 0; j < 4; j++) {
      const entry = region + 2 + (m * 4 + j) * 4;
      const type = ps[entry];
      if (type === 0) { mac.push({ key: -2 }); continue; }
      mac.push({
        key: m * 4 + j,
        type,
        code1: ps[entry + 1] === 0xff ? -1 : ps[entry + 1],
        code2: ps[entry + 2] === 0xff ? -1 : ps[entry + 2],
        extra: ps[entry + 3],
      });
    }
    slots.push(mac);
  }
  return { count, slots };
}

/**
 * 456B 设备 pad set → 应用 profile。
 * @param {Uint8Array} ps
 * @returns {import('./types.js').AppProfile}
 */
export function decodeProfile(ps) {
  const triggers = [];
  for (let i = 0; i < 6; i++) {
    const slot = ps.slice(OFF.triggerSlots[i], OFF.triggerSlots[i] + TRIGGER_SLOT_SIZE);
    triggers.push(decodeTriggerSlot(slot));
  }
  return {
    motion: decodeMotion(ps),
    shock: decodeShock(ps),
    deadzone: decodeDeadzone(ps),
    triggers,
    keys: decodeKeys(ps),
    macro: decodeMacro(ps),
    light: ps.slice(OFF.lightRegion, OFF.lightRegion + 128),
  };
}
