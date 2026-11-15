/**
 * 508B 写/存储数据流序列化(v39 协议,逆向确认)
 *
 * 依据:
 * - 帧格式:usbcap/WRITE-FORMAT-ANALYSIS.md(抓包 270/270 帧验证)
 * - [0..1] 校验:DevMgr.dll `Utils::crc16_1021` = CRC-16/MODBUS(死区95→DB 00 实测匹配)
 * - 字段布局:WndMgr.dll `CProfileAdaptor::Implant2PadSet_v39`(sub_5E983A10)逆向
 * - 字段值:用户唯一值样本差分验证(src-unique-values / src-dz30-07)
 *
 * 508B 数据流布局(v39,数据流 = 512B 缓冲[4..511],最终格式):
 *   [0..1]   16 位校验 = CRC-16/MODBUS([2..507]) 原值(高字节写 [0])
 *   [2..4]   头 = 01 fc 00(构建前 src 为 fc 01 00,经发送端 word 交换)
 *   [4]      hire 位标志(bit0=左, bit1=右;注意与 [2..4] 重叠? 以抓包为准)
 *   [5..8]   扳机死区范围:
 *              [5] = 左扳机下限, [6] = 100 - 左扳机上限
 *              [7] = 右扳机下限, [8] = 100 - 右扳机上限
 *   [9..11]  00 00 00
 *   [12..13] 功能位(bit 组合,来自 app +480..+496/+1564..+1580)
 *   [14..]   6 个扳机槽(48B/槽,间距 48):
 *              [0]=01 [1]=20 头
 *              [2] = 死区/模式, [3..] = 曲线参数
 *              槽起点:14/62/110/158/206/254
 *   [304]    传感器模式 = sensorMode*16 + enumSensorMode
 *   [305..308] sim_keys 位图(dword LE)
 *   [311]    轴反转/模式位
 *   [312..318] 体感参数(官方字段名,见 MOTION):312=deadzone_comp 315=h2v_ratio
 *             316=gyro_sens 318=resp_curve;313/314/317 无主,原样回传
 *   [315..318] 与 [323..326]、[331..334] 构成同一 motion 块的第 1/2/3 份
 *             (官方只写第 1 份,2/3 份原样回传,待真机确认是否板载档位)
 *   [344..347] 键位使能位图(dword LE)
 *   [352..360] 震动:4 参数(左/右 × 下限/上限,见 SHOCK_LAYOUT,两套布局)+ 档位 [360]
 *   [380..507] 键位槽区 = 32 槽 × 4B:
 *               槽[0] = 键类型(GetKeymapType 0..3), 槽[1..3] = 编码(ImplantKeymap)
 *               (键 0..3 对应槽 23..26,即抓包 [472..487] 形态
 *                `01 0d ff ff 01 00 ff ff 02 00 17 00 02 00 15 00`)
 *   [472..487] 即键位槽 23..26(与 [380..507] 同区,旧文档单独命名) *
 *
 * 扳机槽(48B/槽)内 [24..47] = 扩展区:4 组 × 6B(sub_5E988B20):
 *   组[0] = 组类型, 组[1] = 0, 组[2] = 键类型, 组[3..5] = 键编码
 *
 * 键位编码函数见 keymap.js(全部由 WndMgr.dll 反编译确认)。
 *
 * 已验证(用户唯一值差分):
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

/**
 * **摇杆**曲线槽起点(间距 48B)。
 *
 * ⚠ 历史命名 `TRIGGER_RECORD_*` 是误称。2026-11-15 真机实测（各槽 off+2 写 99）：
 *   槽0(@14)  → LX/LY 归零 = 左摇杆
 *   槽1(@62)  → RX/RY 归零 = 右摇杆
 *   槽2..5(@110/158/206/254) → 对本机型 413D:2104 完全无影响
 * 与 `config.xml` 的 `<joystick_left deadzone_center="12">` ↔ `[16]=12` 交叉印证。
 * 真正的扳机死区在 [5..8]，见 OFF.triggerDeadzone。
 *
 * 槽结构: [0..1]=01 20  [2]=deadzone_center  [3]=?  [4..13]=5 个(x%,y%)断点  [14]=255
 */
export const JOYSTICK_CURVE_OFFSETS = [14, 62, 110, 158, 206, 254];
/** @deprecated 误称（实为摇杆曲线槽），请改用 JOYSTICK_CURVE_OFFSETS */
export const TRIGGER_RECORD_OFFSETS = JOYSTICK_CURVE_OFFSETS;
export const JOYSTICK_CURVE_SIZE = 48;
export const TRIGGER_RECORD_HEADER = [0x01, 0x20];
export const TRIGGER_RECORD_SIZE = 48;

export const OFF = {
  checksum16: 0,      // [0..1] CRC-16/MODBUS
  header: 2,          // [2..3] = 01 fc
  hireFlags: 4,       // [4] bit0=左 hire, bit1=右 hire（真机实测，见 parse.hire）
  triggerDeadzone: 5, // [5..8] [5]=左低 [6]=100-左高 [7]=右低 [8]=100-右高（实测 9/9 吻合）
  featFlags: 12,      // [12..13]
  triggers: 14,       // ⚠ 误称:6 个摇杆曲线槽 × 48B，见 JOYSTICK_CURVE_OFFSETS
  sensorMode: 304,    // [304] sensorMode*16 + enumSensorMode
  simKeys: 305,       // [305..308] dword LE
  axisFlags: 311,     // [311]
  gyro: 312,          // [312..318] 体感参数区(逐字节含义见 MOTION)
  keyEnable: 344,     // [344..347] dword LE
  shock: 352,         // [352..360] 震动参数(逐字节含义见 SHOCK_LAYOUT)
  keySlots: 380,      // [380..507] 32 槽 × 4B(键类型+编码)
  keySection: 472,    // [472..487] = 键位槽 23..26(兼容旧命名)
};

/** 扳机槽内字段偏移(48B) */
export const TRIGGER_SLOT = {
  header: 0,       // 01 20
  deadzone: 2,     // 死区/模式字节
  param: 3,        // 参数区
  curve: 4,        // 曲线点起
  ext: 24,         // 扩展区(4 组 × 6B, sub_5E988B20)
};

/**
 * 体感(motion)参数 —— 官方字段名来自 `BIGBIG WON/config.xml` 的 `<motion .../>`:
 *   gyro_sens="60" h2v_ratio="10" resp_curve="42" deadzone_comp="0"
 * 与 `DefaultConfig.ini` 的 `Rainbow3_508_0x39` 的 [315..318]=10,60,60,42 逐字节吻合。
 *
 * 注意:312..318 不是"陀螺仪 7 字节",官方只写 312/315/316/318 四个字节,
 * 313/314/317 无主(由默认模板带来,原样回传)。
 */
export const MOTION = {
  mode: 304,         // sensorMode<<4 | enumSensorMode
  simKeys: 305,      // dword LE 位图
  axisFlags: 311,    // 轴反转/模式位(bit0..4 由多个 app 字段组合)
  deadzoneComp: 312, // deadzone_comp 死区补偿
  h2vRatio: 315,     // h2v_ratio    体感→摇杆横向比例
  gyroSens: 316,     // gyro_sens    陀螺灵敏度
  respCurve: 318,    // resp_curve   响应曲线参数
};

/**
 * 震动参数布局 —— `Implant2PadSet_v39` 按机型分支写两套偏移:
 *   分支 A(if `*sub_5E6F2D90()==0`)→ 354/355 + 358/359
 *   分支 B(else)                   → 352/353 + 356/357
 * 值与 app profile 的 [376]/[384](下限 L/R) 与 [380]/[388](上限 L/R) 对应。
 */
export const SHOCK_LAYOUT = {
  A: { leftMin: 354, rightMin: 355, leftMax: 358, rightMax: 359 },
  B: { leftMin: 352, rightMin: 353, leftMax: 356, rightMax: 357 },
};
/** 震动档位(来源是适配器实例字段 this+12862,不属于 profile;写回建议沿用原值) */
export const SHOCK_GRADE = 360;

/**
 * 从设备字节猜震动布局:两套布局互斥,哪套有非零值就是哪套。
 * (官方默认模板里 B 套只有 1,1,远小于 A 套的 50/200,判定稳定)
 */
export function detectShockLayout(payload) {
  const sum = (o) => payload[o.leftMin] + payload[o.rightMin] + payload[o.leftMax] + payload[o.rightMax];
  return sum(SHOCK_LAYOUT.B) > sum(SHOCK_LAYOUT.A) ? "B" : "A";
}

const u8v = (v) => Math.max(0, Math.min(255, Math.trunc(Number(v) || 0)));

/**
 * CRC-16/MODBUS:poly=0x8005(reflected 0xA001), init=0xFFFF, refin/refout=true, xorout=0。
 * 与 DevMgr.dll `Utils::crc16_1021` 等价。
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
  // 6 个摇杆曲线槽(历史误称 "triggers")：0=左摇杆 1=右摇杆，2..5 本机型不用
  const joystickSlots = JOYSTICK_CURVE_OFFSETS.map((off) => ({
    offset: off,
    header: [payload[off], payload[off + 1]],
    /** off+2 = config.xml 的 joystick_*.deadzone_center */
    deadzoneCenter: payload[off + 2],
    /** @deprecated 同上，旧字段名 */
    deadzone: payload[off + 2],
    /** off+4..13 = 5 个 (输入%, 输出%) 断点；输入轴是**径向模长**，不是单轴，见 §12 */
    points: Array.from({ length: 5 }, (_, i) => ({
      in: payload[off + 4 + i * 2],
      out: payload[off + 5 + i * 2],
    })),
    /** off+3..14 原始字节（兼容旧调用） */
    param: Array.from(payload.subarray(off + 3, off + 15)),
  }));
  return {
    checksum16: ((payload[0] << 8) | payload[1]),
    checksumOk: payload[0] === computePayloadChecksum(payload) >> 8
      && payload[1] === (computePayloadChecksum(payload) & 0xff),
    header: [payload[2], payload[3]],
    /**
     * 扳机 hire（微动扳机 / hair trigger）位域，[4]（真机实测）。
     *   bit0 = 左扳机，bit1 = 右扳机；bit2/3 与本机扳机无关。
     * hire=1 时该扳机退化为二值开关：R >= 低死区 → 255，否则 0，**顶端死区被忽略**。
     * 与物理微动开关互相独立（物理切换不改写任何配置字节，实测 508B 完全不变）。
     */
    hire: {
      left: (payload[4] & 0x01) !== 0,
      right: (payload[4] & 0x02) !== 0,
      raw: payload[4],
    },
    triggerDeadzone: {
      leftLow: u8(5),
      leftHigh: 100 - u8(6),   // [6] = 100-上限
      rightLow: u8(7),
      rightHigh: 100 - u8(8),  // [8] = 100-上限
    },
    featFlags: [u8(12), u8(13)],
    /** @deprecated 误称，实为摇杆曲线槽，语义与 joystickCurves 完全相同 */
    triggers: joystickSlots,
    joystickCurves: joystickSlots,
    sensorModeByte: u8(304),
    simKeys: (payload[305] | (payload[306] << 8) | (payload[307] << 16) | (payload[308] << 24)) >>> 0,
    axisFlags: u8(311),
    gyro: Array.from(payload.subarray(312, 319)),
    /** 体感参数(官方字段名);313/314/317 无主,不在其中 */
    motion: {
      sensorMode: u8(304) >> 4,
      enumSensorMode: u8(304) & 0x0f,
      deadzoneComp: u8(MOTION.deadzoneComp),
      h2vRatio: u8(MOTION.h2vRatio),
      gyroSens: u8(MOTION.gyroSens),
      respCurve: u8(MOTION.respCurve),
      axisFlags: u8(MOTION.axisFlags),
    },
    /** 震动参数(已解语义),layout 为判定出的布局 */
    shockParams: (() => {
      const layout = detectShockLayout(payload);
      const o = SHOCK_LAYOUT[layout];
      return {
        layout,
        leftMin: u8(o.leftMin),
        rightMin: u8(o.rightMin),
        leftMax: u8(o.leftMax),
        rightMax: u8(o.rightMax),
        grade: u8(SHOCK_GRADE),
      };
    })(),
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
 * @param {object} [cfg.hire] 扳机微动开关 {left:boolean, right:boolean} → [4] bit0/bit1
 * @param {object} [cfg.triggerDeadzone] 扳机死区范围 {leftLow,leftHigh,rightLow,rightHigh}
 * @param {number[][]} [cfg.joystickCurves] 6 个摇杆曲线槽(每槽 48B)；旧名 cfg.triggers 仍可用
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
  // [4] hire 位域：默认沿用 from，读-改-写绝不能把设备的 hire 设置清掉
  if (cfg.from && cfg.from.length === PAYLOAD_SIZE) p[4] = cfg.from[4];
  const hire = cfg.hire;
  if (hire) {
    if (hire.left !== undefined) p[4] = (p[4] & ~0x01) | (hire.left ? 0x01 : 0);
    if (hire.right !== undefined) p[4] = (p[4] & ~0x02) | (hire.right ? 0x02 : 0);
  }
  // 扳机死区范围
  const dz = cfg.triggerDeadzone ?? {};
  if (dz.leftLow !== undefined) p[5] = dz.leftLow;
  if (dz.leftHigh !== undefined) p[6] = 100 - dz.leftHigh;
  if (dz.rightLow !== undefined) p[7] = dz.rightLow;
  if (dz.rightHigh !== undefined) p[8] = 100 - dz.rightHigh;
  // 摇杆曲线槽（旧名 triggers）
  const slots = cfg.joystickCurves ?? cfg.triggers;
  if (slots) {
    for (let i = 0; i < 6; i++) {
      const off = JOYSTICK_CURVE_OFFSETS[i];
      const slot = slots[i];
      if (slot && slot.length === JOYSTICK_CURVE_SIZE) {
        p.set(slot, off);
      }
    }
  } else if (!cfg.from && !padset) {
    // 默认记录:01 20 + 死区 100 补码(与设备默认一致)
    for (const off of JOYSTICK_CURVE_OFFSETS) {
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
 * 字段映射依据 WndMgr `Implant2PadSet_v39`(见 v39-layout.js)。
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
  // 交错排列:L-默认/R-默认/L-Curve1/R-Curve1/L-Curve2/R-Curve2(反编译确认)
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
    // 扩展键映射区(sub_5E988B20: 4 组 × 6B,曲线窗口的 DirectionalTrigger)
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
  // 体感 4 参数(官方名:gyro_sens / h2v_ratio / resp_curve / deadzone_comp)
  if (m.gyroSens !== undefined) p[MOTION.gyroSens] = u8v(m.gyroSens);
  if (m.h2vRatio !== undefined) p[MOTION.h2vRatio] = u8v(m.h2vRatio);
  if (m.respCurve !== undefined) p[MOTION.respCurve] = u8v(m.respCurve);
  if (m.deadzoneComp !== undefined) p[MOTION.deadzoneComp] = u8v(m.deadzoneComp);
  if (m.axisFlags !== undefined) p[MOTION.axisFlags] = u8v(m.axisFlags);
  // 震动:4 参数(左/右 × 下限/上限)+ 档位
  // 布局 A/B 由设备字节判定(shock.layout 可显式指定);旧 raw 9 字节输入仍兼容
  const sh = profile.shock ?? {};
  if (Array.isArray(sh.bytes) && sh.bytes.length === 9) p.set(sh.bytes, 352);
  const shockOff = SHOCK_LAYOUT[sh.layout === "B" ? "B" : "A"];
  if (sh.leftMin !== undefined) p[shockOff.leftMin] = u8v(sh.leftMin);
  if (sh.rightMin !== undefined) p[shockOff.rightMin] = u8v(sh.rightMin);
  if (sh.leftMax !== undefined) p[shockOff.leftMax] = u8v(sh.leftMax);
  if (sh.rightMax !== undefined) p[shockOff.rightMax] = u8v(sh.rightMax);
  if (sh.grade !== undefined) p[SHOCK_GRADE] = u8v(sh.grade);
  // 键位:键条目 → 键类型槽区 [380..507] + 使能位图 [344..347]
  // (对齐 WndMgr Implant2PadSet_v39 末尾循环:sub_5E988BC0/650/690/800)
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


/* ============================ 摇杆径向响应模型 ============================ */

/** XInput 摇杆满量程 */
export const STICK_FULL_SCALE = 32767;

/**
 * 5 点分段线性查表（输入 0..100 → 输出 0..100）。
 * 低于首个断点时按 (0,0)→(p0.in,p0.out) 线性插值（真机实测，见 §12.5），
 * 高于末个断点时钳位到末点输出。
 */
export function evalCurvePoints(points, x) {
  const pts = points.map((p) => ({ in: p.in ?? p.input, out: p.out ?? p.output }));
  if (!pts.length) return 0;
  if (x <= 0) return 0;
  const first = pts[0];
  if (x <= first.in) return first.in > 0 ? (x / first.in) * first.out : first.out;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (x <= b.in) {
      const span = b.in - a.in;
      return span > 0 ? a.out + ((x - a.in) / span) * (b.out - a.out) : b.out;
    }
  }
  return pts[pts.length - 1].out;
}

/**
 * 按固件实测模型把摇杆原始输入映射为输出。
 *
 * ⚠ 关键语义：曲线作用于 **二维模长**，查一次表后整个向量按同一比例缩放，
 * **方向严格不变**。不是逐轴查表（真机 4 组对照验证，见 508B-FIELD-MAP-v39.md §12）。
 *
 * ```
 * r  = hypot(lx,ly)/32767*100
 * r <= dz          → (0,0)
 * 否则 r1 = (r-dz)/(100-dz)*100 ; y = curve(r1)
 * 输出模长 = y/100*32767 ; 方向 = 原方向
 * ```
 *
 * @param {{deadzoneCenter?:number, points:{in:number,out:number}[]}} slot parse 出的摇杆槽
 * @param {number} lx 原始 X（-32768..32767）
 * @param {number} ly 原始 Y（-32768..32767）
 * @returns {{x:number, y:number, radius:number, out:number, clamped:boolean}}
 *   radius = 输入模长百分比，out = 查表输出百分比，clamped = 是否被死区归零
 */
export function applyJoystickCurve(slot, lx, ly) {
  const R = STICK_FULL_SCALE;
  const dz = slot?.deadzoneCenter ?? 0;
  const radius = (Math.hypot(lx, ly) / R) * 100;
  if (radius <= 0) return { x: 0, y: 0, radius: 0, out: 0, clamped: true };
  if (dz >= 100 || radius <= dz) return { x: 0, y: 0, radius, out: 0, clamped: true };
  const r1 = ((radius - dz) / (100 - dz)) * 100;
  const out = evalCurvePoints(slot?.points ?? [], r1);
  const scale = (out / 100) * R / Math.hypot(lx, ly);
  return { x: lx * scale, y: ly * scale, radius, out, clamped: false };
}
