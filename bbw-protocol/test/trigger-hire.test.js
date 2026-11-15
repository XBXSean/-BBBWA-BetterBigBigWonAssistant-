import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseWritePayload, serializeWritePayload, computePayloadChecksum,
  PAYLOAD_SIZE, JOYSTICK_CURVE_OFFSETS, TRIGGER_RECORD_OFFSETS,
} from "../src/index.js";

/** 构造一份校验自洽的基线 508B */
function basePayload() {
  const p = new Uint8Array(PAYLOAD_SIZE);
  p[2] = 0x01; p[3] = 0xfc;
  for (const off of JOYSTICK_CURVE_OFFSETS) {
    p[off] = 0x01; p[off + 1] = 0x20;
    p[off + 2] = 12; // deadzone_center 默认
    for (let j = 4; j < 14; j++) p[off + j] = 0;
    p[off + 14] = 255;
  }
  const cs = computePayloadChecksum(p);
  p[0] = (cs >> 8) & 0xff; p[1] = cs & 0xff;
  return p;
}

// ---- [4] hire 位域（2026-11-15 真机实测）----

test("[4] hire: 解析 bit0=左 bit1=右", () => {
  const p = basePayload();
  p[4] = 0x00;
  assert.deepEqual(
    { l: parseWritePayload(p).hire.left, r: parseWritePayload(p).hire.right },
    { l: false, r: false },
  );

  p[4] = 0x01;
  assert.deepEqual(
    { l: parseWritePayload(p).hire.left, r: parseWritePayload(p).hire.right },
    { l: true, r: false },
  );

  p[4] = 0x02;
  assert.deepEqual(
    { l: parseWritePayload(p).hire.left, r: parseWritePayload(p).hire.right },
    { l: false, r: true },
  );

  p[4] = 0x03; // 实测 3 → LT 变 255
  assert.deepEqual(
    { l: parseWritePayload(p).hire.left, r: parseWritePayload(p).hire.right },
    { l: true, r: true },
  );

  // bit2/bit3 与本机扳机无关：0x0c 不应被当成 hire
  p[4] = 0x0c;
  assert.deepEqual(
    { l: parseWritePayload(p).hire.left, r: parseWritePayload(p).hire.right },
    { l: false, r: false },
  );
});

// ---- 回归：读-改-写不得清掉 hire ----

test("读-改-写保留 [4]（旧实现必定清零，是 bug）", () => {
  const base = basePayload();
  base[4] = 0x03;
  const out = serializeWritePayload({ from: base });
  assert.equal(out[4], 0x03, "未显式改 hire 时必须沿用原值");
});

test("显式 hire 只改对应位，不影响另一侧", () => {
  const base = basePayload();
  base[4] = 0x02; // 右 hire 已开
  const outL = serializeWritePayload({ from: base, hire: { left: true } });
  assert.equal(outL[4], 0x03, "左侧置位不应清掉右侧");
  const outOff = serializeWritePayload({ from: base, hire: { right: false } });
  assert.equal(outOff[4], 0x00, "右侧清位");
});

test("显式 hire 后校验和自洽", () => {
  const out = serializeWritePayload({ hire: { left: true } });
  assert.equal(parseWritePayload(out).checksumOk, true);
});

// ---- 扳机死区：out = (R-low)/(high-low)*255，low=[5], high=100-[6] ----

test("扳机死区编码: leftHigh=80 → [6]=20, rightHigh=90 → [8]=10", () => {
  const out = serializeWritePayload({
    triggerDeadzone: { leftLow: 20, leftHigh: 80, rightLow: 0, rightHigh: 90 },
  });
  assert.equal(out[5], 20);
  assert.equal(out[6], 20);
  assert.equal(out[7], 0);
  assert.equal(out[8], 10);

  const back = parseWritePayload(out).triggerDeadzone;
  assert.deepEqual(back, { leftLow: 20, leftHigh: 80, rightLow: 0, rightHigh: 90 });
});

// ---- 命名修正：6 槽是摇杆曲线槽，不是扳机槽 ----

test("JOYSTICK_CURVE_OFFSETS 是 TRIGGER_RECORD_OFFSETS 的同一数组（兼容别名）", () => {
  assert.deepEqual([...JOYSTICK_CURVE_OFFSETS], [14, 62, 110, 158, 206, 254]);
  assert.deepEqual([...TRIGGER_RECORD_OFFSETS], [...JOYSTICK_CURVE_OFFSETS]);
});

test("摇杆槽解析出 5 个 (输入,输出) 断点 + deadzoneCenter", () => {
  const p = basePayload();
  // 槽0 默认曲线 (20,20)(40,40)(60,60)(80,80)(95,100)
  const pts = [[20, 20], [40, 40], [60, 60], [80, 80], [95, 100]];
  pts.forEach(([x, y], i) => { p[14 + 4 + i * 2] = x; p[14 + 5 + i * 2] = y; });
  const slot = parseWritePayload(p).joystickCurves[0];
  assert.equal(slot.offset, 14);
  assert.equal(slot.deadzoneCenter, 12);
  assert.deepEqual(slot.points, pts.map(([x, y]) => ({ in: x, out: y })));
});

test("triggers 与 joystickCurves 指向同一份数据（旧调用不破）", () => {
  const parsed = parseWritePayload(basePayload());
  assert.deepEqual(parsed.triggers, parsed.joystickCurves);
});

test("header 只含 [2..3]，不再把 [4] hire 混进头部", () => {
  const p = basePayload();
  p[4] = 0x03;
  assert.deepEqual(parseWritePayload(p).header, [0x01, 0xfc]);
});

// ---- 摇杆槽序列化仍可用 joystickCurves 别名 ----

test("serializeWritePayload 接受 joystickCurves 并原样写回", () => {
  const base = basePayload();
  const slot = new Uint8Array(48);
  slot.set(base.subarray(62, 110));
  slot[10] = 77; // 改一个曲线点，验证确实写进去了
  const out = serializeWritePayload({ from: base, joystickCurves: [null, slot] });
  assert.equal(out[62 + 10], 77);
});
