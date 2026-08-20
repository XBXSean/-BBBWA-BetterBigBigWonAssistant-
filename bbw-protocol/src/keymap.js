/**
 * 键位/宏编码模块(纯函数,无 IO)
 *
 * 来源:官方配置工具行为分析 + 真机读写验证。
 * 实现的功能(均为键位槽区/扳机扩展区的编码规则):
 * - keyCodeToBitmap:键码 → 使能位图
 * - bitmapToSlot:位图 → 槽位索引(最低置位位)
 * - getKeymapType:键条目 → 设备键类型(0..3)
 * - implantKeymap:类型 + 键列表 → 3B 编码
 * - transform2HWKeyboard:Windows 虚拟键码 → USB HID 键盘用法码
 * - isPhysicalButton:code < 18 && code != -1
 * - isModifierKey:修饰键(Ctrl/Shift/Alt/Win 左右)
 * - encodeTriggerExtension:扳机槽扩展区 4 组 × 6B([0]=组类型 [1]=0 [2]=键类型 [3..5]=编码)
 *
 * 数据模型(应用 profile 键条目):
 *   { code, type, enabled, keys }
 *   - code: 物理键码(0..24, -1=无, -2=未使用; 0..17 为物理按键)
 *   - type: 应用键类型(0=单键/组合, 1=宏A, 2=宏B)
 *   - enabled: 是否启用
 *   - keys: 虚拟键码数组
 *
 * 已验证:真机抓包键位区 `01 0d ff ff 01 00 ff ff 02 00 17 00 02 00 15 00`
 * (槽 23..26 = 键 0..3)与本模块编码完全一致。
 */

/** 键码 → 使能位图(固定表)。fw 相关键 21..24 见 keyCodeToBitmap */
export const KEY_CODE_TO_BITMAP = {
  [-1]: 0x4,           // 键 -1 → bit2(槽 2)
  0: 0x800000,         // bit23
  1: 0x1000000,        // bit24
  2: 0x2000000,        // bit25
  3: 0x4000000,        // bit26
  4: 0x1,              // bit0
  5: 0x2,              // bit1
  6: 0x8,              // bit3
  7: 0x10,             // bit4
  8: 0x10000,          // bit16
  9: 0x20000,          // bit17
  10: 0x40000,         // bit18
  11: 0x80000,         // bit19
  12: 0x40,            // bit6
  13: 0x100,           // bit8
  14: 0x80,            // bit7
  15: 0x200,           // bit9
  16: 0x2000,          // bit13
  17: 0x4000,          // bit14
  18: 0x8000,          // bit15
  19: 0x800,           // bit11
  20: 0x400,           // bit10
};

/** 键 21..24 的固件相关位图(case 21..24;fwType=设备类型字节) */
export const KEY_CODE_TO_BITMAP_FW = {
  21: { 5: 0x8000000, 7: 0x8000000, 15: 0x8000000, 11: 0x40000000 },
  22: { 5: 0x20000000, 7: 0x20000000, 15: 0x20000000, 11: 0x10000000 },
  23: { 5: 0x400000, 7: 0x400000, 15: 0x400000, 11: 0x8000000 },
  24: { 5: 0x10000000, 7: 0x10000000, 15: 0x10000000, 11: 0x20000000 },
};

/**
 * 键码 → 使能位图。
 * @param {number} code 键码(-1..24)
 * @param {object} [opts]
 * @param {number} [opts.fwType=5] 设备类型字节(5/7/15 与 11 表不同;仅影响键 21..24)
 * @param {number} [opts.bitmapOverride=0] 运行时全局覆盖位图(非 0 时键 21..24 全部用它)
 * @returns {number} 位图(无匹配 → 0)
 */
export function keyCodeToBitmap(code, opts = {}) {
  if (code in KEY_CODE_TO_BITMAP) return KEY_CODE_TO_BITMAP[code];
  if (code >= 21 && code <= 24) {
    if (opts.bitmapOverride) return opts.bitmapOverride;
    const fw = opts.fwType ?? 5;
    return KEY_CODE_TO_BITMAP_FW[code][fw] ?? 0;
  }
  return 0;
}

/**
 * 位图 → 槽位索引(最低置位位 0..31;无 → -1)。
 * 键位槽区偏移 = 380 + 4 * slot。
 */
export function bitmapToSlot(bitmap) {
  for (let i = 0; i < 32; i++) {
    if (bitmap & (1 << i)) return i;
  }
  return -1;
}

/** 物理按键判定:code < 18 && code != -1 */
export function isPhysicalButton(code) {
  return code < 18 && code !== -1;
}

/** 修饰键判定:L/R Ctrl、Shift、Alt、Win */
const MODIFIER_VKS = new Set([160, 161, 162, 163, 164, 165, 91, 92]);
export function isModifierKey(vk) {
  return MODIFIER_VKS.has(vk);
}

/**
 * Windows 虚拟键码 → USB HID 键盘用法码。
 * 已对照 USB HID Usage Tables 验证。未映射 → 0。
 */
const VK_TO_HID = {
  // 控制键
  8: 42,    // Backspace
  9: 43,    // Tab
  13: 40,   // Enter
  20: 57,   // CapsLock
  27: 41,   // Esc
  32: 44,   // Space
  33: 75,   // PageUp
  34: 78,   // PageDown
  35: 77,   // End
  36: 74,   // Home
  37: 80,   // ←
  38: 82,   // ↑
  39: 79,   // →
  40: 81,   // ↓
  44: 70,   // PrintScreen
  45: 73,   // Insert
  46: 76,   // Delete
  // 数字行 0..9
  48: 39, 49: 30, 50: 31, 51: 32, 52: 33, 53: 34, 54: 35, 55: 36, 56: 37, 57: 38,
  // 修饰键(HID 修饰字节值)
  91: 8,    // LWin
  92: 0x80, // RWin
  160: 2,   // LShift
  161: 32,  // RShift
  162: 1,   // LCtrl
  163: 16,  // RCtrl
  164: 4,   // LAlt
  165: 64,  // RAlt
  // 小键盘 0..9
  96: 98, 97: 89, 98: 90, 99: 91, 100: 92, 101: 93, 102: 94, 103: 95, 104: 96, 105: 97,
  // 标点
  186: 51,  // ;
  187: 46,  // =
  188: 54,  // ,
  189: 45,  // -
  190: 55,  // .
  191: 56,  // /
  192: 53,  // `
  219: 47,  // [
  220: 49,  // \
  221: 48,  // ]
  222: 52,  // '
};

/** 区间映射:A-Z(65..90 → 4..29)、F1-F12(112..123 → 58..69) */
function vkToHidRange(vk) {
  if (vk >= 65 && vk <= 90) return vk - 61;   // A=4 ... Z=29
  if (vk >= 112 && vk <= 123) return vk - 54; // F1=58 ... F12=69
  return null;
}

/** @param {number} vk Windows 虚拟键码 */
export function transform2HWKeyboard(vk) {
  if (vk in VK_TO_HID) return VK_TO_HID[vk];
  const r = vkToHidRange(vk);
  return r === null ? 0 : r;
}

/**
 * 键条目 → 设备键类型字节。
 * @param {object} entry {code, type, keys}
 *   type=应用类型(0 单键/组合, 1 宏A, 2 宏B)
 * @returns {number} 0=无/自映射, 1=组合(按键槽位), 2=宏A(HID), 3=宏B(单字节值)
 */
export function getKeymapType(entry) {
  const { code, type = 0, keys = [] } = entry;
  if (type === 1) return keys.length ? 2 : 0;
  if (type === 2) return keys.length ? 3 : 0;
  if (type !== 0) return 0;
  if (keys.length === 0) return 0;
  if (keys.length === 1 && keys[0] === code) return 0;
  return 1;
}

/**
 * 键编码:设备键类型 + 键列表 → 3 字节编码。
 * @param {number} type getKeymapType 输出(0..3)
 * @param {number[]} keys 虚拟键码数组(组合时为物理键码,宏时为 VK)
 * @param {object} [opts] 透传 keyCodeToBitmap 选项(fwType/bitmapOverride)
 * @returns {number[]} 3 字节 [b1,b2,b3](字节值 0..255)
 */
export function implantKeymap(type, keys = [], opts = {}) {
  const b = [0, 0, 0];
  switch (type) {
    case 0:
      // 无/自映射:清空编码
      return b;
    case 1: {
      // 组合:每字节 = 目标物理键的槽位索引;空/-1 → 0xFF
      for (let i = 0; i < 3; i++) {
        if (i >= keys.length || keys[i] === -1) b[i] = 0xff;
        else b[i] = bitmapToSlot(keyCodeToBitmap(keys[i], opts));
      }
      return b;
    }
    case 2: {
      // 宏:首键为修饰键 → HID 序列 [hid(k0),hid(k1),hid(k2)];
      // 否则 → [0, hid(k0), hid(k1)]
      if (keys.length === 0) return b;
      if (isModifierKey(keys[0])) {
        b[0] = transform2HWKeyboard(keys[0]);
        for (let j = 1; j < 3; j++) b[j] = j < keys.length ? transform2HWKeyboard(keys[j]) : 0;
      } else {
        b[0] = 0;
        for (let k = 0; k < 2; k++) b[k + 1] = k < keys.length ? transform2HWKeyboard(keys[k]) : 0;
      }
      return b;
    }
    case 3: {
      // 宏B:单字节值 = 首元素低字节
      b[0] = keys.length ? keys[0] & 0xff : 0;
      return b;
    }
    default:
      return b;
  }
}

/**
 * 完整键条目编码 = getKeymapType + implantKeymap。
 * @returns {{type: number, bytes: number[]}}
 */
export function encodeKeyEntry(entry, opts = {}) {
  const type = getKeymapType(entry);
  return { type, bytes: implantKeymap(type, entry.keys ?? [], opts) };
}

/** 键位槽区 [380..507]:32 槽 × 4B */
export const KEY_SLOT_OFFSET = 380;
export const KEY_SLOT_COUNT = 32;
export const KEY_SLOT_SIZE = 4;

/** 扳机槽扩展区:每槽 4 组 × 6B(组内 [0]=组类型 [1]=0 [2]=键类型 [3..5]=编码) */
export const TRIGGER_EXT_GROUP_COUNT = 4;
export const TRIGGER_EXT_GROUP_SIZE = 6;
export const TRIGGER_EXT_SLOT_OFFSET = 24; // 槽内偏移(48B 记录中 [24..47])

/**
 * 扳机槽扩展区编码。
 * @param {Array<{type:number, entry?:object}>} groups 4 组(≤4,缺省=0)
 *   group.type = 组类型字节(源 [0]);group.entry = 键条目 {code,type,keys}
 * @returns {number[]} 24 字节(4 × 6B)
 */
export function encodeTriggerExtension(groups = []) {
  const out = new Array(24).fill(0);
  for (let i = 0; i < Math.min(groups.length, TRIGGER_EXT_GROUP_COUNT); i++) {
    const g = groups[i];
    if (!g) continue;
    const base = i * TRIGGER_EXT_GROUP_SIZE;
    out[base] = g.type ?? 0;
    const enc = encodeKeyEntry(g.entry ?? {}, {});
    out[base + 2] = enc.type;
    out[base + 3] = enc.bytes[0];
    out[base + 4] = enc.bytes[1];
    out[base + 5] = enc.bytes[2];
  }
  return out;
}
