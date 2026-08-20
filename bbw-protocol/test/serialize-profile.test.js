// serializeProfile:应用 profile → 508B 直转验证
import test from "node:test";
import assert from "node:assert/strict";
import { serializeProfile, parseWritePayload, serializeWritePayload } from "../src/write-format.js";

test("serializeProfile:死区+扳机+体感+震动字段写入 508B 正确", () => {
  const profile = {
    deadzone: { c0: 30, s0: 20, c1: 7, s1: 3, hire0: 1, hire1: 0 },
    featFlags: [0x42, 0x01],
    triggers: [
      { mode: 3, c: 15, s: 21, curve: [0x14, 0x14, 0x28, 0x28, 0x3c, 0x3c, 0x50, 0x50, 0x5f, 0x64, 0xff] },
      { mode: 0, c: 6, s: 14 },
    ],
    motion: { sensorMode: 1, enumSensorMode: 2, simKeys: [4, 5] },
    shock: { grade: 7 },
  };
  const p = serializeProfile(profile);
  assert.equal(p.length, 508);
  const parsed = parseWritePayload(p);
  assert.equal(parsed.checksumOk, true, "校验应通过");
  // 死区
  assert.equal(parsed.triggerDeadzone.leftLow, 30);
  assert.equal(parsed.triggerDeadzone.leftHigh, 20);
  assert.equal(parsed.triggerDeadzone.rightLow, 7);
  assert.equal(parsed.triggerDeadzone.rightHigh, 3);
  assert.equal(p[4] & 1, 1, "hire0");
  // 功能位
  assert.equal(p[12], 0x42);
  assert.equal(p[13], 0x01);
  // 扳机0 曲线
  assert.equal(p[14], 0x01); assert.equal(p[15], 0x20);
  assert.equal(p[16], 15); assert.equal(p[17], 100 - 21);
  assert.equal(p[20], 0x28);
  // 体感
  assert.equal(p[304], (1 << 4) | 2, "sensorMode*16+enum");
  assert.equal(p[305] | (p[306] << 8), 0x03, "simKeys 4,5 → bits 1|2");
  // 震动
  assert.equal(p[360], 7);
});

test("serializeProfile:震动区原始 9 字节透传(真机 ground truth)", () => {
  // 用户设备实测 [352..360] = 00 00 32 32 01 01 c8 c8 22(布局未定,按 raw 保真)
  const raw = [0x00, 0x00, 0x32, 0x32, 0x01, 0x01, 0xc8, 0xc8, 0x22];
  const p = serializeProfile({ shock: { bytes: raw } });
  assert.deepEqual(Array.from(p.subarray(352, 361)), raw);
  const parsed = parseWritePayload(p);
  assert.deepEqual(parsed.shock, raw);
  assert.equal(parsed.checksumOk, true);
  // grade 可单独覆盖 [360]
  const p2 = serializeProfile({ shock: { bytes: raw, grade: 0x2a } });
  assert.equal(p2[360], 0x2a);
});

test("serializeProfile 从已有 508B 修改(读-改-写)", () => {
  const base = serializeProfile({ deadzone: { c0: 5, s0: 95, c1: 5, s1: 90 } });
  const p = serializeProfile({ deadzone: { c0: 30, s0: 20 } }, base);
  const parsed = parseWritePayload(p);
  assert.equal(parsed.triggerDeadzone.leftLow, 30);
  assert.equal(parsed.triggerDeadzone.leftHigh, 20);
  // 未修改的右摇杆保留
  assert.equal(parsed.triggerDeadzone.rightLow, 5);
  assert.equal(parsed.triggerDeadzone.rightHigh, 90);
  assert.equal(parsed.checksumOk, true);
});

test("serializeProfile 输出可被 chunkPayload 分帧(与设备格式一致)", async () => {
  const { chunkPayload, dechunkFrames } = await import("../src/chunks.js");
  const p = serializeProfile({ deadzone: { c0: 30, s0: 20, c1: 7, s1: 3 } });
  const frames = chunkPayload(p, 0xd7);
  assert.equal(frames.length, 9);
  const back = dechunkFrames(frames, { validate: true, marker: 0xd7 });
  assert.equal(back.length, 508);
  assert.deepEqual([...back], [...p]);
});

test("serializeProfile:读-改-写保留键位槽区与扳机扩展区(未提供 keys/ext 时)", () => {
  const base = serializeProfile({
    keys: [{ code: 0, type: 0, enabled: true, keys: [16] }],
    triggers: [{ ext: [{ type: 1, entry: { code: 0, type: 1, keys: [162, 84] } }] }],
  });
  // 只改死区,不带 keys/ext → 键位槽/扩展区/使能位图原样保留
  const p = serializeProfile({ deadzone: { c0: 30, s0: 20 } }, base);
  assert.deepEqual(Array.from(p.subarray(472, 488)),
    [0x01, 0x0d, 0xff, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(Array.from(p.subarray(14 + 24, 14 + 30)), [0x01, 0x00, 0x02, 0x01, 0x17, 0x00]);
  assert.equal(p[344] | (p[345] << 8) | (p[346] << 16) | (p[347] << 24), 0x800000);
  // 提供 keys 时重算并清零未启用槽
  const p2 = serializeProfile({ keys: [{ code: 4, type: 0, enabled: true, keys: [4] }] }, base);
  assert.equal(p2[380], 0, "槽0 重算");
  assert.equal(p2[380 + 4 * 23], 0, "旧键0 槽23 被清零");
  const parsed = parseWritePayload(p2);
  assert.equal(parsed.checksumOk, true);
});
