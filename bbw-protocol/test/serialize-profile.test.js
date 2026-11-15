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

/* ===== 2026-11 重新逆向:体感 4 参数 + 震动 4 参数 + 保留区 ===== */

test("体感 4 参数写入官方偏移(312=deadzone_comp 315=h2v_ratio 316=gyro_sens 318=resp_curve)", () => {
  const p = serializeProfile({ motion: { gyroSens: 60, h2vRatio: 10, respCurve: 42, deadzoneComp: 7 } });
  assert.equal(p[316], 60, "gyro_sens");
  assert.equal(p[315], 10, "h2v_ratio");
  assert.equal(p[318], 42, "resp_curve");
  assert.equal(p[312], 7, "deadzone_comp");
  const d = parseWritePayload(p);
  assert.equal(d.motion.gyroSens, 60);
  assert.equal(d.motion.h2vRatio, 10);
  assert.equal(d.motion.respCurve, 42);
  assert.equal(d.motion.deadzoneComp, 7);
  assert.equal(d.checksumOk, true);
});

test("体感区无主字节(313/314/317)必须按设备原值保留", () => {
  const base = serializeProfile({});
  base[313] = 0xaa; base[314] = 0xbb; base[317] = 0xcc;
  const p = serializeProfile({ motion: { gyroSens: 70 } }, base);
  assert.equal(p[313], 0xaa);
  assert.equal(p[314], 0xbb);
  assert.equal(p[317], 0xcc);
  assert.equal(p[316], 70);
});

test("震动 4 参数:A/B 两套偏移写入与自动判定", () => {
  const a = serializeProfile({ shock: { layout: "A", leftMin: 40, rightMin: 41, leftMax: 210, rightMax: 211, grade: 0x22 } });
  assert.deepEqual([a[354], a[355], a[358], a[359]], [40, 41, 210, 211], "布局 A");
  const da = parseWritePayload(a);
  assert.equal(da.shockParams.layout, "A");
  assert.deepEqual([da.shockParams.leftMin, da.shockParams.rightMin, da.shockParams.leftMax, da.shockParams.rightMax],
    [40, 41, 210, 211]);

  const b = serializeProfile({ shock: { layout: "B", leftMin: 40, rightMin: 41, leftMax: 210, rightMax: 211 } });
  assert.deepEqual([b[352], b[353], b[356], b[357]], [40, 41, 210, 211], "布局 B");
  assert.equal(parseWritePayload(b).shockParams.layout, "B");
});

test("真机默认样本:体感/震动解析与官方 config.xml 一致", () => {
  // DefaultConfig.ini Rainbow3_508_0x39 的真实默认值
  const p = new Uint8Array(508);
  const motionBlock = [10, 60, 60, 42];
  for (const base of [315, 323, 331]) motionBlock.forEach((v, i) => { p[base + i] = v; });
  p.set([0x00, 0x00, 0x32, 0x32, 0x01, 0x01, 0xc8, 0xc8, 0x22], 352);
  const d = parseWritePayload(p);
  assert.equal(d.motion.h2vRatio, 10);
  assert.equal(d.motion.gyroSens, 60);
  assert.equal(d.motion.respCurve, 42);
  assert.equal(d.shockParams.layout, "A");
  assert.deepEqual([d.shockParams.leftMin, d.shockParams.rightMin, d.shockParams.leftMax, d.shockParams.rightMax],
    [50, 50, 200, 200]);
  assert.equal(d.shockParams.grade, 0x22);
  // 旧的 raw 数组接口仍可用
  assert.deepEqual(d.shock, [0x00, 0x00, 0x32, 0x32, 0x01, 0x01, 0xc8, 0xc8, 0x22]);
});

test("设备保留区 [309..343]:旧的 stickArea 透传必须失效", () => {
  const base = serializeProfile({});
  base.fill(0x5a, 309, 344);
  const p = serializeProfile({ stickArea: new Array(35).fill(0) }, base);
  assert.equal(p[309], 0x5a, "旧 stickArea 不应覆盖设备保留区");
  assert.equal(p[343], 0x5a);
});
