// 508B payload → 可编辑 profile 模型(尽力反向;未覆盖字段靠写回时 from 保留)
import { parseWritePayload, TRIGGER_RECORD_OFFSETS } from "../../../bbw-protocol/src/write-format.js";
import { SIM_KEY_BITS } from "../../../bbw-protocol/src/layout.js";
import { slotToCode, hidToVkMod, hidToVkKey } from "./names.js";

// sim_keys 位图 → 键列表
const BIT_TO_SIMKEY = {};
for (const [k, b] of Object.entries(SIM_KEY_BITS)) BIT_TO_SIMKEY[b] = Number(k);

// 设备键类型 → 应用类型
function appTypeOf(devType) {
  if (devType === 2) return 1;
  if (devType === 3) return 2;
  return 0;
}

function reverseKeys(devType, bytes) {
  if (devType === 0) return [];
  if (devType === 1) {
    // 组合:bytes = 目标槽位索引(-1/0xFF = 空)
    return bytes.map((b) => (b === 0xff || b === -1) ? -1 : slotToCode(b));
  }
  if (devType === 2) {
    // 宏A:[mod,hid,hid] 首字节为修饰键(HID 修饰字节值);[0,hid,hid] 则取后两字节
    if (bytes[0] !== 0) {
      return [hidToVkMod(bytes[0]), hidToVkKey(bytes[1]), hidToVkKey(bytes[2])].filter((v) => v !== 0);
    }
    return [hidToVkKey(bytes[1]), hidToVkKey(bytes[2])].filter((v) => v !== 0);
  }
  if (devType === 3) return bytes[0] ? [bytes[0]] : [];
  return [];
}

/** 508B → 可编辑 profile(结构对齐 serializeProfile 输入) */
export function payloadToProfile(payload) {
  const d = parseWritePayload(payload);
  const ke = d.keyEnable;
  const keys = [];
  for (let i = 0; i < 32; i++) {
    const s = d.keySlots[i];
    const code = slotToCode(s.slot);
    if (s.type === 0 && s.bytes.every((b) => b === 0)) { keys.push(null); continue; }
    keys.push({
      code,
      type: appTypeOf(s.type),
      enabled: !!(ke & (1 << s.slot)),
      keys: reverseKeys(s.type, s.bytes),
    });
  }
  const simKeys = [];
  for (const [bit, k] of Object.entries(BIT_TO_SIMKEY)) {
    if (d.simKeys & Number(bit)) simKeys.push(k);
  }
  return {
    deadzone: {
      c0: d.triggerDeadzone.leftLow,
      s0: d.triggerDeadzone.leftHigh,
      c1: d.triggerDeadzone.rightLow,
      s1: d.triggerDeadzone.rightHigh,
      hire0: !!(payload[4] & 1),
      hire1: !!(payload[4] & 2),
    },
    featFlags: [payload[12], payload[13]],
    // 摇杆曲线槽(6 槽;L-默认/R-默认/L-C1/R-C1/L-C2/R-C2):
    // [0..1]=01 20 [2]=中心正 [3]=中心负 [4..13]=5曲线点 [14]=稳定系数(-signed)
    // [16..23]=中心偏移字(X@20 Y@22) [24..47]=扩展键映射
    curves: d.triggers.map((rec, i) => {
      const off = TRIGGER_RECORD_OFFSETS[i];
      // 曲线 = 4 连续点(8B [4..11]);[12]=外圈死区(100-补码) [13]=输出上限(100) [14]=稳定系数
      return {
        center: [payload[off + 2], payload[off + 3]],
        points: Array.from(payload.subarray(off + 4, off + 12)),
        outerDz: 100 - payload[off + 12],
        maxOut: payload[off + 13],
        stabilize: -((payload[off + 14] << 24) >> 24),
        ext: d.triggerExt[i].map((g) => ({
          type: g.type,
          entry: {
            code: 0,
            type: appTypeOf(g.keyType),
            enabled: false,
            keys: reverseKeys(g.keyType, g.bytes),
          },
        })),
      };
    }),
    motion: {
      sensorMode: payload[304] >> 4,
      enumSensorMode: payload[304] & 0xf,
      simKeys,
      axisFlags: payload[311],
      gyro: Array.from(payload.subarray(312, 319)),
    },
    shock: { bytes: Array.from(payload.subarray(352, 361)) },
    // 摇杆响应曲线区 [309..343](35B;写路径不覆盖,raw 透传 + from 保真)
    stickArea: Array.from(payload.subarray(309, 344)),
    keys,
  };
}

/** 默认空白 profile(新建/重置用) */
export function blankProfile() {
  const keys = Array.from({ length: 32 }, () => null);
  return {
    deadzone: { c0: 0, s0: 100, c1: 0, s1: 100, hire0: false, hire1: false },
    featFlags: [0, 0],
    curves: Array.from({ length: 6 }, () => ({
      center: [12, 0],
      points: [0x14, 0x14, 0x28, 0x28, 0x3c, 0x3c, 0x50, 0x50],
      outerDz: 5,
      maxOut: 100,
      stabilize: 1,
      ext: Array.from({ length: 4 }, () => ({ type: 0, entry: { code: 0, type: 0, enabled: false, keys: [] } })),
    })),
    motion: { sensorMode: 0, enumSensorMode: 0, simKeys: [], axisFlags: 0, gyro: new Array(7).fill(0) },
    shock: { bytes: new Array(9).fill(0) },
    stickArea: new Array(35).fill(0),
    keys,
  };
}
