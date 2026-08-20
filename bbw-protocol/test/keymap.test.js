// 键位/宏编码单元测试 —— 全部期望值来自官方工具行为分析 + 真机实测
import test from "node:test";
import assert from "node:assert/strict";
import {
  keyCodeToBitmap,
  bitmapToSlot,
  transform2HWKeyboard,
  getKeymapType,
  implantKeymap,
  encodeKeyEntry,
  encodeTriggerExtension,
  isPhysicalButton,
  isModifierKey,
} from "../src/keymap.js";
import { serializeProfile, parseWritePayload } from "../src/write-format.js";

test("keyCodeToBitmap:固定表", () => {
  const cases = {
    [-1]: 0x4, 0: 0x800000, 1: 0x1000000, 2: 0x2000000, 3: 0x4000000,
    4: 0x1, 5: 0x2, 6: 0x8, 7: 0x10, 8: 0x10000, 9: 0x20000,
    10: 0x40000, 11: 0x80000, 12: 0x40, 13: 0x100, 14: 0x80, 15: 0x200,
    16: 0x2000, 17: 0x4000, 18: 0x8000, 19: 0x800, 20: 0x400,
  };
  for (const [code, want] of Object.entries(cases)) {
    assert.equal(keyCodeToBitmap(Number(code)), want, `键码 ${code}`);
  }
  assert.equal(keyCodeToBitmap(99), 0, "未定义键码 → 0");
});

test("keyCodeToBitmap:键 21..24 固件相关", () => {
  assert.equal(keyCodeToBitmap(21), 0x8000000, "fw5/7/15 默认");
  assert.equal(keyCodeToBitmap(21, { fwType: 11 }), 0x40000000);
  assert.equal(keyCodeToBitmap(22, { fwType: 11 }), 0x10000000);
  assert.equal(keyCodeToBitmap(23, { fwType: 11 }), 0x8000000);
  assert.equal(keyCodeToBitmap(24), 0x10000000, "fw5/7/15");
  assert.equal(keyCodeToBitmap(24, { fwType: 11 }), 0x20000000);
  // 运行时全局覆盖(非 0 时优先)
  assert.equal(keyCodeToBitmap(21, { bitmapOverride: 0x400 }), 0x400);
});

test("bitmapToSlot:最低置位位索引", () => {
  assert.equal(bitmapToSlot(0x800000), 23);
  assert.equal(bitmapToSlot(0x1000000), 24);
  assert.equal(bitmapToSlot(0x2000), 13);
  assert.equal(bitmapToSlot(0x4), 2);
  assert.equal(bitmapToSlot(0x1), 0);
  assert.equal(bitmapToSlot(0x80000000), 31);
  assert.equal(bitmapToSlot(0), -1);
});

test("transform2HWKeyboard:VK→HID 全表(对照 USB HID 用法)", () => {
  const cases = {
    8: 42, 9: 43, 13: 40, 20: 57, 27: 41, 32: 44,
    33: 75, 34: 78, 35: 77, 36: 74, 37: 80, 38: 82, 39: 79, 40: 81,
    44: 70, 45: 73, 46: 76,
    48: 39, 49: 30, 50: 31, 51: 32, 52: 33, 53: 34, 54: 35, 55: 36, 56: 37, 57: 38,
    65: 4, 66: 5, 67: 6, 68: 7, 69: 8, 70: 9, 71: 10, 72: 11, 73: 12, 74: 13,
    75: 14, 76: 15, 77: 16, 78: 17, 79: 18, 80: 19, 81: 20, 82: 21, 83: 22, 84: 23,
    85: 24, 86: 25, 87: 26, 88: 27, 89: 28, 90: 29,
    91: 8, 92: 0x80,
    96: 98, 97: 89, 98: 90, 99: 91, 100: 92, 101: 93, 102: 94, 103: 95, 104: 96, 105: 97,
    112: 58, 113: 59, 114: 60, 115: 61, 116: 62, 117: 63, 118: 64, 119: 65, 120: 66, 121: 67,
    122: 68, 123: 69,
    160: 2, 161: 32, 162: 1, 163: 16, 164: 4, 165: 64,
    186: 51, 187: 46, 188: 54, 189: 45, 190: 55, 191: 56, 192: 53,
    219: 47, 220: 49, 221: 48, 222: 52,
  };
  for (const [vk, want] of Object.entries(cases)) {
    assert.equal(transform2HWKeyboard(Number(vk)), want, `VK ${vk}`);
  }
  assert.equal(transform2HWKeyboard(1), 0, "鼠标键 → 0");
  assert.equal(transform2HWKeyboard(0x7f), 0, "未映射 → 0");
});

test("isPhysicalButton/isModifierKey", () => {
  assert.equal(isPhysicalButton(0), true);
  assert.equal(isPhysicalButton(17), true);
  assert.equal(isPhysicalButton(18), false);
  assert.equal(isPhysicalButton(-1), false);
  for (const vk of [160, 161, 162, 163, 164, 165, 91, 92]) {
    assert.equal(isModifierKey(vk), true, `修饰键 VK ${vk}`);
  }
  assert.equal(isModifierKey(84), false);
});

test("getKeymapType:键条目 → 设备键类型", () => {
  // type1 宏A:非空 → 2
  assert.equal(getKeymapType({ code: 0, type: 1, keys: [162, 84] }), 2);
  assert.equal(getKeymapType({ code: 0, type: 1, keys: [] }), 0);
  // type2 宏B:非空 → 3
  assert.equal(getKeymapType({ code: 0, type: 2, keys: [1] }), 3);
  assert.equal(getKeymapType({ code: 0, type: 2, keys: [] }), 0);
  // 其他 type → 0
  assert.equal(getKeymapType({ code: 0, type: 9, keys: [1] }), 0);
  // type0:空 → 0;单键==自身 → 0;否则 → 1
  assert.equal(getKeymapType({ code: 0, type: 0, keys: [] }), 0);
  assert.equal(getKeymapType({ code: 0, type: 0, keys: [0] }), 0, "自映射");
  assert.equal(getKeymapType({ code: 0, type: 0, keys: [16] }), 1, "改绑其他按键");
});

test("implantKeymap:设备类型 → 3B 编码", () => {
  // type0:清空
  assert.deepEqual(implantKeymap(0, [84]), [0, 0, 0]);
  // type1 组合:槽位索引,空/-1 → 0xFF
  assert.deepEqual(implantKeymap(1, [16]), [0x0d, 0xff, 0xff]);
  assert.deepEqual(implantKeymap(1, [4, -1]), [0x00, 0xff, 0xff]);
  assert.deepEqual(implantKeymap(1, []), [0xff, 0xff, 0xff]);
  // type2 宏:首键修饰键 → HID 序列
  assert.deepEqual(implantKeymap(2, [162, 84]), [0x01, 0x17, 0x00], "Ctrl+T");
  assert.deepEqual(implantKeymap(2, [162, 84, 67]), [0x01, 0x17, 0x06], "Ctrl+T+C");
  // type2 宏:首键非修饰 → [0, hid(k0), hid(k1)]
  assert.deepEqual(implantKeymap(2, [84]), [0x00, 0x17, 0x00], "单键 T");
  assert.deepEqual(implantKeymap(2, [84, 82]), [0x00, 0x17, 0x15], "T+R");
  assert.deepEqual(implantKeymap(2, []), [0, 0, 0]);
  // type3 宏B:首元素低字节
  assert.deepEqual(implantKeymap(3, [0x1234]), [0x34, 0x00, 0x00]);
  assert.deepEqual(implantKeymap(3, []), [0, 0, 0]);
});

test("encodeKeyEntry 组合(GetKeymapType + ImplantKeymap)", () => {
  assert.deepEqual(encodeKeyEntry({ code: 0, type: 0, keys: [16] }), { type: 1, bytes: [0x0d, 0xff, 0xff] });
  assert.deepEqual(encodeKeyEntry({ code: 2, type: 1, keys: [84] }), { type: 2, bytes: [0x00, 0x17, 0x00] });
  assert.deepEqual(encodeKeyEntry({ code: 4, type: 0, keys: [4] }), { type: 0, bytes: [0, 0, 0] }, "自映射");
});

test("encodeTriggerExtension:4 组 × 6B", () => {
  const ext = encodeTriggerExtension([
    { type: 1, entry: { code: 0, type: 1, keys: [162, 84] } }, // Ctrl+T 宏
  ]);
  assert.equal(ext.length, 24);
  // 组0:[0]=组类型 1, [1]=0, [2]=键类型 2, [3..5]=[1,0x17,0]
  assert.deepEqual(ext.slice(0, 6), [1, 0, 2, 0x01, 0x17, 0x00]);
  assert.deepEqual(ext.slice(6), new Array(18).fill(0), "其余组为 0");
  // 默认全 0
  assert.deepEqual(encodeTriggerExtension(), new Array(24).fill(0));
});

// ─── 官方软件真机 ground truth(M1..M4 → 键盘 1/2/3/4,实测) ───
test("serializeProfile:官方软件 M1..M4→键盘1..4 输出逐字节复现(enabled=0)", () => {
  // 官方软件写回:键位槽 23..26 = 02 00 1e 00 02 00 1f 00 02 00 20 00 02 00 21 00,使能位图=0
  const keys = [0, 1, 2, 3].map((code, i) => ({ code, type: 1, enabled: false, keys: [49 + i] }));
  const p = serializeProfile({ keys });
  assert.deepEqual(
    Array.from(p.subarray(472, 488)),
    [0x02, 0x00, 0x1e, 0x00, 0x02, 0x00, 0x1f, 0x00, 0x02, 0x00, 0x20, 0x00, 0x02, 0x00, 0x21, 0x00]
  );
  const ke = p[344] | (p[345] << 8) | (p[346] << 16) | (p[347] << 24);
  assert.equal(ke >>> 0, 0, "官方 enabled=0 → 使能位图不置位");
  // enabled=true 对照:同一绑定应置位
  const p2 = serializeProfile({ keys: keys.map((k) => ({ ...k, enabled: true })) });
  const ke2 = p2[344] | (p2[345] << 8) | (p2[346] << 16) | (p2[347] << 24);
  assert.equal(ke2 >>> 0, 0x7800000);
});

// ─── 真机抓包复现:[472..487] = 01 0d ff ff 01 00 ff ff 02 00 17 00 02 00 15 00 ───
test("serializeProfile:键位槽区复现抓包形态(键 0..3 → 槽 23..26)", () => {
  const profile = {
    keys: [
      { code: 0, type: 0, enabled: true, keys: [16] },  // 键0 → 按键16(槽13)
      { code: 1, type: 0, enabled: true, keys: [4] },   // 键1 → 按键4(槽0)
      { code: 2, type: 1, enabled: true, keys: [84] },  // 键2 → 宏 'T'
      { code: 3, type: 1, enabled: true, keys: [82] },  // 键3 → 宏 'R'
    ],
  };
  const p = serializeProfile(profile);
  const section = Array.from(p.subarray(472, 488));
  assert.deepEqual(
    section,
    [0x01, 0x0d, 0xff, 0xff, 0x01, 0x00, 0xff, 0xff, 0x02, 0x00, 0x17, 0x00, 0x02, 0x00, 0x15, 0x00],
    "与抓包 [472..487] 逐字节一致"
  );
  // 键位使能 = 0x800000|0x1000000|0x2000000|0x4000000 = 0x7800000
  const ke = p[344] | (p[345] << 8) | (p[346] << 16) | (p[347] << 24);
  assert.equal(ke >>> 0, 0x7800000);
  const parsed = parseWritePayload(p);
  assert.equal(parsed.checksumOk, true);
  assert.equal(parsed.keySlots[23].type, 1);
  assert.deepEqual(parsed.keySlots[23].bytes, [0x0d, 0xff, 0xff]);
  assert.equal(parsed.keySlots[25].type, 2);
  assert.deepEqual(parsed.keySlots[25].bytes, [0x00, 0x17, 0x00]);
});

test("serializeProfile:键位使能规则(仅 enabled 且符合条件的置位)", () => {
  const p = serializeProfile({
    keys: [
      { code: 4, type: 0, enabled: true, keys: [4] },    // 物理键+enabled → 置位 bit0
      { code: 5, type: 0, enabled: false, keys: [5] },   // 未启用 → 不置位
      { code: 18, type: 0, enabled: true, keys: [18] },  // 非物理键(18) → 不置位
      { code: 20, type: 2, enabled: true, keys: [1] },   // type2 → 使能位不动
    ],
  });
  const ke = p[344] | (p[345] << 8) | (p[346] << 16) | (p[347] << 24);
  assert.equal(ke >>> 0, 0x1, "仅键4 置位");
  // 键18 槽位(bit15=槽15)仍写编码
  assert.equal(p[380 + 4 * 15], getKeymapType({ code: 18, type: 0, keys: [18] }));
});

test("serializeProfile:扳机槽扩展区写入(trigger ext)", () => {
  const p = serializeProfile({
    triggers: [
      { mode: 3, c: 15, s: 21, ext: [
        { type: 1, entry: { code: 0, type: 1, keys: [162, 84] } }, // Ctrl+T
        { type: 2, entry: { code: 1, type: 0, keys: [16] } },      // 组合→槽13
      ] },
    ],
  });
  const off = 14; // 槽0
  assert.deepEqual(Array.from(p.subarray(off + 24, off + 30)), [0x01, 0x00, 0x02, 0x01, 0x17, 0x00]);
  assert.deepEqual(Array.from(p.subarray(off + 30, off + 36)), [0x02, 0x00, 0x01, 0x0d, 0xff, 0xff]);
  // 其他槽扩展区保持 0
  assert.deepEqual(Array.from(p.subarray(62 + 24, 62 + 48)), new Array(24).fill(0));
  const parsed = parseWritePayload(p);
  assert.equal(parsed.checksumOk, true);
  assert.deepEqual(parsed.triggerExt[0][0].bytes, [0x01, 0x17, 0x00]);
  assert.equal(parsed.triggerExt[0][1].keyType, 1);
});

test("serializeProfile 无 keys/ext 时输出与旧行为一致(键位区全 0)", () => {
  const p = serializeProfile({ deadzone: { c0: 30, s0: 20 } });
  assert.deepEqual(Array.from(p.subarray(380, 508)), new Array(128).fill(0));
  assert.equal(p[344] | (p[345] << 8) | (p[346] << 16) | (p[347] << 24), 0);
  const parsed = parseWritePayload(p);
  assert.equal(parsed.checksumOk, true);
});
