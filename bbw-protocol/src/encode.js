/**
 * profile → 设备 pad set(456B)编码
 *
 * 带 TODO 的项语义未经真机验证。
 */
import {
  PADSET_SIZE, OFF, TRIGGER_SLOT, TRIGGER_SLOT_SIZE,
  SIM_KEY_BITS, keyBit, clampInt, writeU32,
} from "./layout.js";

/**
 * 编码一个扳机槽(14B)。
 * @param {Uint8Array} slot
 * @param {import('./types.js').TriggerConfig} t
 */
export function encodeTriggerSlot(slot, t = {}) {
  slot[TRIGGER_SLOT.mode] = clampInt(t.mode ?? 0, 0, 255);
  slot[TRIGGER_SLOT.param1] = clampInt(t.param1 ?? 0, 0, 255);
  slot[TRIGGER_SLOT.c] = clampInt(t.c ?? 0, 0, 100);
  slot[TRIGGER_SLOT.s] = clampInt(t.s ?? 0, 0, 100);
  for (let i = 0; i < 8; i++) {
    const v = (t.curve && t.curve[i]) ?? 0;
    slot[TRIGGER_SLOT.curve + i] = clampInt(v, -128, 127) & 0xff;
  }
  // 第二组阈值存 100 补码(默认 0 → 设备字节 100)
  slot[TRIGGER_SLOT.thresholdA] = clampInt(100 - (t.c2 ?? 0), 0, 100);
  slot[TRIGGER_SLOT.thresholdB] = clampInt(100 - (t.s2 ?? 0), 0, 100);
}

/**
 * 解码一个扳机槽。
 * @param {Uint8Array} slot
 * @returns {import('./types.js').TriggerConfig}
 */
export function decodeTriggerSlot(slot) {
  const curve = [];
  for (let i = 0; i < 8; i++) {
    const b = slot[TRIGGER_SLOT.curve + i];
    curve.push(b >= 0x80 ? b - 0x100 : b); // 符号扩展
  }
  return {
    mode: slot[TRIGGER_SLOT.mode],
    param1: slot[TRIGGER_SLOT.param1],
    c: slot[TRIGGER_SLOT.c],
    s: slot[TRIGGER_SLOT.s],
    curve,
    c2: 100 - slot[TRIGGER_SLOT.thresholdA],
    s2: 100 - slot[TRIGGER_SLOT.thresholdB],
  };
}

function encodeMotion(ps, m = {}) {
  ps[OFF.gyro.a] = clampInt(m.gyroA ?? 0, 0, 255);
  ps[OFF.gyro.b] = clampInt(m.gyroB ?? 0, 0, 255);
  ps[OFF.gyro.c] = clampInt(m.gyroC ?? 0, 0, 255);
  ps[OFF.gyro.d] = clampInt(m.gyroD ?? 0, 0, 255);
  const enumMode = clampInt(m.enumSensorMode ?? 0, 0, 2);
  const mode = clampInt(m.sensorMode ?? 0, 0, 15);
  ps[OFF.motionMode] = mode * 16 + enumMode;
  // 轴反转位
  let flags = 0;
  if (enumMode === 1) {
    if (m.xAxisReversal) flags |= 0x02;
    if (m.yAxisReversal) flags |= 0x04;
  } else if (enumMode === 2) {
    if (m.extraFlag) flags |= 0x01;
    if (m.xAxisReversal) flags |= 0x08;
    if (m.yAxisReversal) flags |= 0x10;
  }
  ps[OFF.axisFlags] = flags;
  // sim_keys 位图
  let bits = 0;
  for (const k of m.simKeys ?? []) {
    const b = SIM_KEY_BITS[k];
    if (b !== undefined) bits |= b;
  }
  writeU32(ps, OFF.simKeys, bits);
}

function encodeShock(ps, s = {}) {
  const layout = s.modelB ? OFF.shock.layoutB : OFF.shock.layoutA;
  const params = s.params ?? [];
  for (let i = 0; i < 4; i++) ps[layout[i]] = clampInt(params[i] ?? 0, 0, 255);
  ps[OFF.motorIndex] = clampInt(s.grade ?? 0, 0, 255);
}

function encodeDeadzone(ps, dz = {}) {
  ps[OFF.dz.c0] = clampInt(dz.c0 ?? 0, 0, 255);
  ps[OFF.dz.s0] = clampInt(100 - (dz.s0 ?? 0), 0, 255);
  ps[OFF.dz.c1] = clampInt(dz.c1 ?? 0, 0, 255);
  ps[OFF.dz.s1] = clampInt(100 - (dz.s1 ?? 0), 0, 255);
  ps[OFF.hwMode] = (dz.hire0 ? 0x01 : 0) | (dz.hire1 ? 0x02 : 0);
}

function encodeKeys(ps, keys = []) {
  let enable = 0;
  const actions = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const k = keys[i];
    if (!k || k.key === undefined || k.key < 0) continue;
    const bit = keyBit(k.key);
    if (k.enabled === false) continue;
    enable |= bit;
    const entryOff = OFF.keyEntries + 4 * i;
    ps[entryOff] = k.type ?? 1;
    ps[entryOff + 1] = clampInt(k.code1 ?? -1, -1, 255);
    ps[entryOff + 2] = clampInt(k.code2 ?? -1, -1, 255);
    ps[entryOff + 3] = clampInt(k.extra ?? 0, 0, 255);
    if (k.action !== undefined) actions[i] = clampInt(k.action, 0, 255);
  }
  writeU32(ps, OFF.keymapEnable, enable);
  for (let i = 0; i < 32; i++) ps[OFF.keyActions + i] = actions[i];
  // 键位区魔数
  ps[OFF.keymapRegion] = 0x5a;
}

function encodeMacro(ps, macro = {}) {
  const region = OFF.macroRegion;
  ps[region] = 0xd8;
  ps[region + 1] = clampInt(macro.count ?? 0, 0, 255);
  const slots = macro.slots ?? [];
  for (let m = 0; m < 4; m++) {
    const mac = slots[m] ?? [];
    for (let j = 0; j < 4; j++) {
      const entry = region + 2 + (m * 4 + j) * 4;
      const k = mac[j];
      if (!k || k.key === undefined || k.key < 0) {
        writeU32(ps, entry, 0);
        continue;
      }
      ps[entry] = k.type ?? 1;
      ps[entry + 1] = clampInt(k.code1 ?? -1, -1, 255);
      ps[entry + 2] = clampInt(k.code2 ?? -1, -1, 255);
      ps[entry + 3] = clampInt(k.extra ?? 0, 0, 255);
    }
  }
}

/**
 * 应用 profile → 456B 设备 pad set。
 * @param {import('./types.js').AppProfile} profile
 * @returns {Uint8Array}
 */
export function encodeProfile(profile) {
  const ps = new Uint8Array(PADSET_SIZE);
  const p = profile ?? {};

  encodeMotion(ps, p.motion);
  encodeShock(ps, p.shock);
  encodeDeadzone(ps, p.deadzone);

  const triggers = p.triggers ?? [];
  for (let i = 0; i < 6; i++) {
    const slot = new Uint8Array(TRIGGER_SLOT_SIZE);
    encodeTriggerSlot(slot, triggers[i]);
    ps.set(slot, OFF.triggerSlots[i]);
  }

  encodeKeys(ps, p.keys);
  encodeMacro(ps, p.macro);

  if (p.light && p.light.length >= 128) {
    ps.set(p.light.slice(0, 128), OFF.lightRegion);
  }

  return ps;
}
