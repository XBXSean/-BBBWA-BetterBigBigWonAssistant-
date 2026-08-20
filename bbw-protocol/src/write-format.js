/**
 * 508B 写/存储数据流序列化(v39 协议)
 *
 * 说明:本模块描述手柄配置的「写数据流」格式——508 字节,与「读数据流」
 * (456B pad set,见 layout.js/encode.js)是两套不同构的序列化。
 * 所有字段偏移均经真机读写验证,以实测为准。
 *
 * 508B 数据流布局(v39,数据流 = 512B 缓冲[4..511],最终格式):
 *   [0..1]   16 位校验 = CRC-16/MODBUS([2..507]) 原值(高字节写 [0])
 *   [2..4]   头 = 01 fc 00(构建前为 fc 01 00,发送端做 word 交换)
 *   [4]      hire 位标志(bit0=左, bit1=右)
 *   [5..8]   扳机死区范围:
 *              [5] = 左扳机下限, [6] = 100 - 左扳机上限
 *              [7] = 右扳机下限, [8] = 100 - 右扳机上限
 *   [9..11]  00 00 00
 *   [12..13] 功能位(bit 组合)
 *   [14..]   6 个摇杆曲线槽(48B/槽,间距 48):
 *              [0]=01 [1]=20 头
 *              [2] = 中心死区正半程, [3] = 中心死区负半程
 *              [4..11] = 4 个连续曲线点(8B)
 *              [12] = 外圈死区(100-补码), [13] = 上限输出, [14] = 稳定系数(-signed)
 *              [16..23] = 中心偏移字, [24..47] = 扩展键映射(4 组 × 6B)
 *              槽起点:14/62/110/158/206/254(交错 L-默认/R-默认/L-C1/R-C1/L-C2/R-C2)
 *   [304]    传感器模式 = sensorMode*16 + enumSensorMode
 *   [305..308] sim_keys 位图(dword LE)
 *   [311]    轴反转/模式位
 *   [312..318] 陀螺仪参数
 *   [344..347] 键位使能位图(dword LE;实测不门控激活,设备只看键位槽区)
 *   [352..360] 震动参数(原始 9 字节透传,布局未定)
 *   [380..507] 键位槽区 = 32 槽 × 4B:
 *                槽[0] = 键类型(0..3), 槽[1..3] = 编码
 *                (键 0..3 对应槽 23..26,即 [472..487] 形态
 *                 `01 0d ff ff 01 00 ff ff 02 00 17 00 02 00 15 00`)
 *   [472..487] 即键位槽 23..26(与 [380..507] 同区)
 *
 * 已验证(唯一值样本差分):
 *   [5]=左扳机下限, [6]=100-上限(B 组: 6..14 → [5]=8? [6]=86=100-14 ✓)
 *   [7]=右扳机下限, [8]=100-上限(A 组: 2..43 → [7]=2 [8]=57=100-43 ✓)
 */
import { SIM_KEY_BITS } from "./layout.js";
import {
  KEY_SLOT_OFFSET,
  KEY_SLOT_COUNT,
  KEY_SLOT_SIZE,
  TRIGGER_EXT_SLOT_OFFSET,
  TRIGGER_EXT_GROUP_COUNT,
  TRIGGER_EXT_GROUP_SIZE,
  keyCodeToBitmap,
  bitmapToSlot,
  getKeymapType,
  implantKeymap,
  isPhysicalButton,
  encodeTriggerExtension,
} from "./keymap.js";

export const PAYLOAD_SIZE = 508;

/** 扳机槽起点(间距 48B) */
export const TRIGGER_RECORD_OFFSETS = [14, 62, 110, 158, 206, 254];
export const TRIGGER_RECORD_HEADER = [0x01, 0x20];
export const TRIGGER_RECORD_SIZE = 48;

export const OFF = {
  checksum16: 0,      // [0..1] CRC-16/MODBUS
  header: 2,          // [2..4] = fc 01 00
  hireFlags: 4,       // [4] bit0=左, bit1=右
  triggerDeadzone: 5, // [5..8] 扳机死区范围(低值 + 100-高值)
  featFlags: 12,      // [12..13]
  triggers: 14,       // 6 槽 × 48B
  sensorMode: 304,    // [304] sensorMode*16 + enumSensorMode
  simKeys: 305,       // [305..308] dword LE
  axisFlags: 311,     // [311]
  gyro: 312,          // [312..318]
  keyEnable: 344,     // [344..347] dword LE
  shock: 352,         // [352..360]
  keySlots: 380,      // [380..507] 32 槽 × 4B(键类型+编码)
  keySection: 472,    // [472..487] = 键位槽 23..26
};

/** 扳机槽内字段偏移(48B) */
export const TRIGGER_SLOT = {
  header: 0,       // 01 20
  deadzone: 2,     // 死区/模式字节
  param: 3,        // 参数区
  curve: 4,        // 曲线点起
  ext: 24,         // 扩展区(4 组 × 6B)
};

/**
 * CRC-16/MODBUS:poly=0x8005(reflected 0xA001), init=0xFFFF, refin/refout=true, xorout=0。
 */
export function crc16Modbus(data) {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 1) ? (crc >> 1) ^ 0xa001 : crc >> 1;
    }
  }
  return crc & 0xffff;
}

/** 508B 数据流 [0..1] 校验 = CRC-16/MODBUS(数据流[2..507]) 原值(高字节写 [0]) */
export function computePayloadChecksum(payload) {
  if (payload.length !== PAYLOAD_SIZE) {
    throw new Error(`写数据流长度应为 ${PAYLOAD_SIZE},实际 ${payload.length}`);
  }
  return crc16Modbus(payload.subarray(2)); // 0xDB00 → 数据流[0]=DB [1]=00
}

/**
 * 解析 508B 写数据流。
 * @param {Uint8Array} payload 508B
 */
export function parseWritePayload(payload) {
  if (payload.length !== PAYLOAD_SIZE) {
    throw new Error(`写数据流长度应为 ${PAYLOAD_SIZE},实际 ${payload.length}`);
  }
  const u8 = (o) => payload[o];
  return {
    checksum16: ((payload[0] << 8) | payload[1]),
    checksumOk: payload[0] === computePayloadChecksum(payload) >> 8
      && payload[1] === (computePayloadChecksum(payload) & 0xff),
    header: [payload[2], payload[3], payload[4]],
    triggerDeadzone: {
      leftLow: u8(5),
      leftHigh: 100 - u8(6),   // [6] = 100-上限
      rightLow: u8(7),
      rightHigh: 100 - u8(8),  // [8] = 100-上限
    },
    featFlags: [u8(12), u8(13)],
    triggers: TRIGGER_RECORD_OFFSETS.map((off) => {
      const rec = { offset: off, header: [payload[off], payload[off + 1]] };
      rec.deadzone = payload[off + 2];
      rec.param = Array.from(payload.subarray(off + 3, off + 15));
      return rec;
    }),
    sensorModeByte: u8(304),
    simKeys: (payload[305] | (payload[306] << 8) | (payload[307] << 16) | (payload[308] << 24)) >>> 0,
    axisFlags: u8(311),
    gyro: Array.from(payload.subarray(312, 319)),
    shock: Array.from(payload.subarray(352, 361)),
    keyEnable: (payload[344] | (payload[345] << 8) | (payload[346] << 16) | (payload[347] << 24)) >>> 0,
    keySlots: Array.from({ length: KEY_SLOT_COUNT }, (_, i) => {
      const off = KEY_SLOT_OFFSET + i * KEY_SLOT_SIZE;
      return {
        slot: i,
        type: payload[off],
        bytes: [payload[off + 1], payload[off + 2], payload[off + 3]],
      };
    }),
    triggerExt: TRIGGER_RECORD_OFFSETS.map((off) =>
      Array.from({ length: TRIGGER_EXT_GROUP_COUNT }, (_, g) => {
        const base = off + TRIGGER_EXT_SLOT_OFFSET + g * TRIGGER_EXT_GROUP_SIZE;
        return {
          type: payload[base],
          keyType: payload[base + 2],
          bytes: [payload[base + 3], payload[base + 4], payload[base + 5]],
        };
      })
    ),
    keySection: Array.from(payload.subarray(472, 488)),
  };
}

/**
 * 序列化 508B 写数据流。
 * 兼容两种输入:
 *   - cfg.from: 508B 数据流(读-改-写,保留未修改字段)
 *   - padset(直接传 Uint8Array): 456B 设备结构(encodeProfile 输出),
 *     从中提取死区字段映射到 508B [5..8](同偏移)
 * @param {object|Uint8Array} [cfg]
 * @param {Uint8Array} [cfg.from] 基于已有 508B 拷贝
 * @param {object} [cfg.triggerDeadzone] 扳机死区范围 {leftLow,leftHigh,rightLow,rightHigh}
 * @param {number[]} [cfg.triggers] 6 个扳机槽数据(每槽 48B)
 */
export function serializeWritePayload(cfg = {}) {
  // 兼容旧调用:serializeWritePayload(padset)
  if (cfg instanceof Uint8Array) cfg = { padset: cfg };
  const { padset } = cfg;
  const p = new Uint8Array(PAYLOAD_SIZE);
  if (cfg.from && cfg.from.length === PAYLOAD_SIZE) {
    p.set(cfg.from); // 读-改-写:保留未修改字段
  } else if (padset && padset.length >= 456) {
    // 456B pad set → 508B:死区/功能位同偏移拷贝
    p[5] = padset[5]; p[6] = padset[6];
    p[7] = padset[7]; p[8] = padset[8];
    p[12] = padset[12]; p[13] = padset[13];
  }
  p[2] = 0x01;
  p[3] = 0xfc;
  p[4] = 0x00; // hire 标志位(默认 0)
  // 扳机死区范围
  const dz = cfg.triggerDeadzone ?? {};
  if (dz.leftLow !== undefined) p[5] = dz.leftLow;
  if (dz.leftHigh !== undefined) p[6] = 100 - dz.leftHigh;
  if (dz.rightLow !== undefined) p[7] = dz.rightLow;
  if (dz.rightHigh !== undefined) p[8] = 100 - dz.rightHigh;
  // 扳机槽
  if (cfg.triggers) {
    for (let i = 0; i < 6; i++) {
      const off = TRIGGER_RECORD_OFFSETS[i];
      const slot = cfg.triggers[i];
      if (slot && slot.length === TRIGGER_RECORD_SIZE) {
        p.set(slot, off);
      }
    }
  } else if (!cfg.from && !padset) {
    // 默认记录:01 20 + 死区 100 补码(与设备默认一致)
    for (const off of TRIGGER_RECORD_OFFSETS) {
      p[off] = 0x01; p[off + 1] = 0x20;
      for (let j = 2; j < 14; j++) p[off + j] = 0x64; // 100
    }
  }
  const cs = computePayloadChecksum(p);
  p[0] = (cs >> 8) & 0xff;
  p[1] = cs & 0xff;
  return p;
}

/** 便捷:从 profile 的 deadzone 构造扳机死区范围字段 */
export function deadzoneToTriggerRange(dz = {}) {
  return {
    leftLow: dz.c0 ?? 0,
    leftHigh: dz.s0 ?? 100,
    rightLow: dz.c1 ?? 0,
    rightHigh: dz.s1 ?? 100,
  };
}

/**
 * 应用 profile → 508B 写数据流直转(绕过 456B 读格式)。
 * 字段映射见 v39-layout.js。
 * @param {import('./types.js').AppProfile} profile
 * @param {Uint8Array} [from] 已有 508B(可选,读-改-写保留其他字段)
 * @param {object} [opts] 键位编码选项(见 keymap.js keyCodeToBitmap)
 *   profile.keys: 32 个键条目 {code, type, enabled, keys}(缺省=code:-2 跳过)
 *   profile.triggers[i].ext: 4 组 {type, entry:{code,type,keys}}(缺省=全 0)
 */
export function serializeProfile(profile = {}, from = null, opts = {}) {
  const p = serializeWritePayload({ from });
  const dz = profile.deadzone ?? {};
  if (dz.c0 !== undefined) p[5] = dz.c0;
  if (dz.s0 !== undefined) p[6] = 100 - dz.s0;
  if (dz.c1 !== undefined) p[7] = dz.c1;
  if (dz.s1 !== undefined) p[8] = 100 - dz.s1;
  if (dz.hire0 !== undefined) p[4] = (p[4] & ~1) | (dz.hire0 ? 1 : 0);
  if (dz.hire1 !== undefined) p[4] = (p[4] & ~2) | (dz.hire1 ? 2 : 0);
  // 功能位
  const feat = profile.featFlags ?? profile.feat;
  if (feat) { p[12] = feat[0] ?? 0; p[13] = feat[1] ?? 0; }
  // 摇杆曲线槽:6 槽 × 48B @14/62/110/158/206/254
  // 交错排列:L-默认/R-默认/L-Curve1/R-Curve1/L-Curve2/R-Curve2
  // 槽结构:[0..1]=01 20 [2]=中心正 [3]=中心负 [4..13]=5曲线点 [14]=稳定系数(-signed)
  //        [16..23]=中心偏移字(X@20 Y@22) [24..47]=扩展键映射
  // 兼容旧字段:mode/c/s/curve(11B)仍可用
  const curves = profile.curves ?? profile.triggers ?? [];
  for (let i = 0; i < 6; i++) {
    const off = TRIGGER_RECORD_OFFSETS[i];
    const t = curves[i];
    if (!t) continue;
    p[off] = 0x01; p[off + 1] = 0x20;
    if (Array.isArray(t.center) && t.center.length === 2) {
      p[off + 2] = t.center[0] ?? 0;  // 中心正半程
      p[off + 3] = t.center[1] ?? 0;  // 中心负半程
    } else {
      p[off + 2] = t.mode ?? p[off + 2] ?? 0;
      if (t.c !== undefined) p[off + 2] = t.c;
      if (t.s !== undefined) p[off + 3] = 100 - t.s;
    }
    // 曲线 = 4 连续点(8B [4..11]);[12]=外圈死区(100-补码) [13]=输出上限 [14]=稳定系数
    if (Array.isArray(t.points) && t.points.length === 8) {
      p.set(t.points, off + 4);
    } else if (Array.isArray(t.curve)) {
      for (let j = 0; j < Math.min(t.curve.length, 11); j++) p[off + 4 + j] = t.curve[j];
    }
    if (t.outerDz !== undefined) p[off + 12] = 100 - t.outerDz;
    if (t.maxOut !== undefined) p[off + 13] = t.maxOut;
    if (t.stabilize !== undefined) p[off + 14] = (-t.stabilize) & 0xff; // 存储 = -显示值
    // 扩展键映射区(4 组 × 6B,曲线窗口的 DirectionalTrigger)
    if (t.ext && t.ext.length) {
      const ext = encodeTriggerExtension(t.ext);
      p.set(ext, off + TRIGGER_EXT_SLOT_OFFSET);
    }
  }
  // 体感
  const m = profile.motion ?? {};
  if (m.sensorMode !== undefined || m.enumSensorMode !== undefined) {
    p[304] = ((m.sensorMode ?? 0) << 4) | (m.enumSensorMode ?? 0);
  }
  if (m.simKeys) {
    let bits = 0;
    for (const k of m.simKeys) {
      const b = (k >= 0 && k <= 20) ? (SIM_KEY_BITS[k] ?? 0) : 0;
      bits |= b;
    }
    p[305] = bits & 0xff; p[306] = (bits >> 8) & 0xff;
    p[307] = (bits >> 16) & 0xff; p[308] = (bits >>> 24) & 0xff;
  }
  // 震动:[352..360] 原始 9 字节透传(设备实测 00 00 32 32 01 01 c8 c8 22,
  // 布局未完全确认,按 raw 保真,不猜布局)
  const sh = profile.shock ?? {};
  if (Array.isArray(sh.bytes) && sh.bytes.length === 9) p.set(sh.bytes, 352);
  if (sh.grade !== undefined) p[360] = sh.grade;
  // 摇杆响应曲线区 [309..343](35B):写路径不覆盖,设备保留/走单独命令;
  // 提供 raw 透传以便日后分析,写回时 from 已自动保留
  if (Array.isArray(profile.stickArea) && profile.stickArea.length === 35) {
    p.set(profile.stickArea, 309);
  }
  // 键位:键条目 → 键类型槽区 [380..507] + 使能位图 [344..347]
  if (Array.isArray(profile.keys)) {
    p.fill(0, KEY_SLOT_OFFSET, KEY_SLOT_OFFSET + KEY_SLOT_COUNT * KEY_SLOT_SIZE);
    let keyEnable = 0;
    for (const entry of profile.keys) {
      if (!entry || entry.code === -2) continue;
      const bitmap = keyCodeToBitmap(entry.code, opts);
      const slot = bitmapToSlot(bitmap);
      if (slot === -1) continue;
      const type = getKeymapType(entry);
      const bytes = implantKeymap(type, entry.keys ?? [], opts);
      const so = KEY_SLOT_OFFSET + slot * KEY_SLOT_SIZE;
      p[so] = type;
      p[so + 1] = bytes[0]; p[so + 2] = bytes[1]; p[so + 3] = bytes[2];
      // 使能位:type0 需 enabled+物理按键;type1 需 enabled;type>=2 不动
      const appType = entry.type ?? 0;
      if (appType !== 0 && appType !== 1) continue;
      const shouldEnable = appType === 1
        ? !!entry.enabled
        : (!!entry.enabled && isPhysicalButton(entry.code));
      if (shouldEnable) keyEnable |= bitmap;
      else keyEnable &= ~bitmap;
    }
    p[344] = keyEnable & 0xff; p[345] = (keyEnable >> 8) & 0xff;
    p[346] = (keyEnable >> 16) & 0xff; p[347] = (keyEnable >>> 24) & 0xff;
  }
  const cs = computePayloadChecksum(p);
  p[0] = (cs >> 8) & 0xff;
  p[1] = cs & 0xff;
  return p;
}
