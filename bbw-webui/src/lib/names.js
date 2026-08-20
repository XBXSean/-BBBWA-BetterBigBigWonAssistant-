// 键名与反向映射(用于 UI 展示/反向解析)
import { KEY_CODE_TO_BITMAP } from "../../../bbw-protocol/src/keymap.js";

// 物理键码名称(0..3 = M1..M4 已验证;4..7 由 simKeys 位形推断;其余可用「物理按键学习」自定义)
export const KEY_NAMES = {
  0: "M1", 1: "M2", 2: "M3", 3: "M4",
  4: "A", 5: "B", 6: "X", 7: "Y",
  8: "键8", 9: "键9", 10: "键10", 11: "键11", 12: "键12", 13: "键13",
  14: "键14", 15: "键15", 16: "键16", 17: "键17",
  18: "键18", 19: "键19", 20: "键20", 21: "键21", 22: "键22", 23: "键23", 24: "键24",
};
export const keyName = (code) => KEY_NAMES[code] ?? `键${code}`;

// 槽位 → 物理键码(KEY_CODE_TO_BITMAP 逆表;键 21..24 取 fw5 默认)
const BITMAP_TO_CODE = {};
for (const [code, bm] of Object.entries(KEY_CODE_TO_BITMAP)) BITMAP_TO_CODE[bm] = Number(code);
BITMAP_TO_CODE[0x8000000] = 21;   // fw5: 键21 → bit27
BITMAP_TO_CODE[0x20000000] = 22;  // fw5: 键22 → bit29
BITMAP_TO_CODE[0x400000] = 23;    // fw5: 键23 → bit22
BITMAP_TO_CODE[0x10000000] = 24;  // fw5: 键24 → bit28
export const slotToCode = (slot) => BITMAP_TO_CODE[1 << slot] ?? -1;

// HID → VK(transform2HWKeyboard 逆表;含区间 A-Z/F1-F12)
// 数字行查表(与 keymap.js 一致):48→39('0') 49→30('1') … 57→38('9')
const DIGIT_HID = { 48: 39, 49: 30, 50: 31, 51: 32, 52: 33, 53: 34, 54: 35, 55: 36, 56: 37, 57: 38 };
const HID_TO_VK = {};
const VK_TO_HID = {
  8: 42, 9: 43, 13: 40, 20: 57, 27: 41, 32: 44, 33: 75, 34: 78, 35: 77, 36: 74,
  37: 80, 38: 82, 39: 79, 40: 81, 44: 70, 45: 73, 46: 76, 91: 8, 92: 0x80,
  96: 98, 97: 89, 98: 90, 99: 91, 100: 92, 101: 93, 102: 94, 103: 95, 104: 96, 105: 97,
  160: 2, 161: 32, 162: 1, 163: 16, 164: 4, 165: 64,
  186: 51, 187: 46, 188: 54, 189: 45, 190: 55, 191: 56, 192: 53, 219: 47, 220: 49, 221: 48, 222: 52,
};
Object.assign(VK_TO_HID, DIGIT_HID);
for (let vk = 65; vk <= 90; vk++) VK_TO_HID[vk] = vk - 61;  // A-Z
for (let vk = 112; vk <= 123; vk++) VK_TO_HID[vk] = vk - 54; // F1-F12
for (const [vk, hid] of Object.entries(VK_TO_HID)) {
  if (!(hid in HID_TO_VK)) HID_TO_VK[hid] = Number(vk);
}
export const hidToVk = (hid) => HID_TO_VK[hid] ?? 0;

// 修饰键 HID ↔ VK(与字母/数字有冲突,如 RShift=32='3'、LAlt=4='a';按语义优先解释)
const HID_MOD_TO_VK = { 1: 162, 2: 160, 4: 164, 8: 91, 16: 163, 32: 161, 64: 165, 128: 92 };
const HID_KEY_TO_VK = {};
for (const [vk, hid] of Object.entries(DIGIT_HID)) HID_KEY_TO_VK[hid] = Number(vk);
for (let vk = 65; vk <= 90; vk++) HID_KEY_TO_VK[vk - 61] = vk;
/** 按"修饰键"优先解释(HID 修饰字节值) */
export const hidToVkMod = (hid) => HID_MOD_TO_VK[hid] ?? hidToVk(hid);
/** 按"字母/数字键"优先解释 */
export const hidToVkKey = (hid) => HID_KEY_TO_VK[hid] ?? hidToVk(hid);

// VK → 可读名(键位录制器/展示用)
const VK_NAMES = {
  8: "Backspace", 9: "Tab", 13: "Enter", 20: "CapsLock", 27: "Esc", 32: "Space",
  33: "PageUp", 34: "PageDown", 35: "End", 36: "Home", 37: "←", 38: "↑", 39: "→", 40: "↓",
  44: "PrintScreen", 45: "Insert", 46: "Delete", 91: "Win", 92: "RWin",
  160: "LShift", 161: "RShift", 162: "LCtrl", 163: "RCtrl", 164: "LAlt", 165: "RAlt",
  186: ";", 187: "=", 188: ",", 189: "-", 190: ".", 191: "/", 192: "`",
  219: "[", 220: "\\", 221: "]", 222: "'",
};
export const vkName = (vk) => {
  if (vk === -1) return "(无)";
  if (VK_NAMES[vk]) return VK_NAMES[vk];
  if (vk >= 48 && vk <= 57) return String.fromCharCode(vk);
  if (vk >= 65 && vk <= 90) return String.fromCharCode(vk);
  if (vk >= 96 && vk <= 105) return `小键盘${vk - 96}`;
  if (vk >= 112 && vk <= 123) return `F${vk - 111}`;
  return `VK${vk}`;
};
