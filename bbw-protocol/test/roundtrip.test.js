import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeProfile, decodeProfile, encodeTriggerSlot, decodeTriggerSlot } from "../src/index.js";
import {
  chunkPadset, dechunkReports, dechunkFrames, chunkPayload,
  computeFrameChecksum, checkPosOf, READ_QUERY, MARKER_READ,
  CHUNK_COUNT, REPORT_SIZE, PAYLOAD_SIZE_VERIFIED,
} from "../src/index.js";
import { parseWritePayload, PAYLOAD_SIZE } from "../src/index.js";
import { BURST0 } from "./fixtures-burst0.js";
import { TRIGGER_SLOT_SIZE } from "../src/index.js";
import { OFF } from "../src/index.js";

function sampleProfile() {
  return {
    motion: {
      gyroA: 60, gyroB: 10, gyroC: 42, gyroD: 5,
      enumSensorMode: 1, sensorMode: 0,
      simKeys: [4],
      xAxisReversal: 0, yAxisReversal: 0,
    },
    shock: { grade: 3, params: [0, 255, 0, 255], modelB: false },
    deadzone: { c0: 12, s0: 30, c1: 12, s1: 30, hire0: 1, hire1: 0 },
    triggers: [
      { mode: 0, param1: 1, c: 20, s: 80, curve: [0, 20, 40, 60, 80, 100, 120, 127], c2: 5, s2: 10 },
      { mode: 1, param1: 2, c: 15, s: 85, curve: [127, 100, 80, 60, 40, 20, 0, -10], c2: 0, s2: 0 },
      { mode: 2, c: 10, s: 90, curve: [0, 0, 0, 0, 0, 0, 0, 0] },
      { mode: 3, c: 25, s: 75, curve: [-128, -100, -50, 0, 50, 100, 120, 127] },
      { mode: 0, c: 30, s: 70, curve: [10, 20, 30, 40, 50, 60, 70, 80] },
      { mode: 1, c: 5, s: 95, curve: [0, 0, 0, 0, 0, 0, 0, 0], c2: 50, s2: 50 },
    ],
    keys: Array.from({ length: 32 }, (_, i) =>
      i === 0 ? { key: 4, type: 1, code1: 0x1e, code2: -1, action: 3, enabled: true }
        : i === 5 ? { key: 7, type: 3, code1: 0x1e, code2: 0x1f, extra: 0, enabled: true }
        : { key: -2 }
    ),
    macro: {
      count: 1,
      slots: [
        [{ key: 0, type: 1, code1: 0x04, code2: -1 }, { key: -2 }, { key: -2 }, { key: -2 }],
        [], [], [],
      ],
    },
    light: new Uint8Array(128).fill(0xab),
  };
}

test("round-trip: encode → decode 保持核心字段一致", () => {
  const p = sampleProfile();
  const ps = encodeProfile(p);
  assert.equal(ps.length, 456, "pad set 大小应为 456");
  const back = decodeProfile(ps);

  assert.equal(back.deadzone.c0, 12);
  assert.equal(back.deadzone.s0, 30);
  assert.equal(back.deadzone.c1, 12);
  assert.equal(back.deadzone.s1, 30);
  assert.equal(back.deadzone.hire0, 1);
  assert.equal(back.deadzone.hire1, 0);

  assert.equal(back.motion.gyroA, 60);
  assert.equal(back.motion.gyroB, 10);
  assert.equal(back.motion.gyroC, 42);
  assert.equal(back.motion.gyroD, 5);
  assert.equal(back.motion.enumSensorMode, 1);
  assert.equal(back.motion.sensorMode, 0);
  assert.deepEqual(back.motion.simKeys, [4]);

  for (let i = 0; i < 6; i++) {
    assert.equal(back.triggers[i].mode, p.triggers[i].mode, `trigger[${i}].mode`);
    assert.equal(back.triggers[i].c, p.triggers[i].c, `trigger[${i}].c`);
    assert.equal(back.triggers[i].s, p.triggers[i].s, `trigger[${i}].s`);
    assert.equal(back.triggers[i].c2, p.triggers[i].c2 ?? 0, `trigger[${i}].c2`);
    assert.equal(back.triggers[i].s2, p.triggers[i].s2 ?? 0, `trigger[${i}].s2`);
    assert.deepEqual(back.triggers[i].curve, p.triggers[i].curve, `trigger[${i}].curve`);
  }

  assert.equal(back.shock.grade, 3);
  assert.deepEqual(back.shock.paramsLayoutA, [0, 255, 0, 255]);

  assert.equal(back.keys[0].type, 1);
  assert.equal(back.keys[0].code1, 0x1e);
  assert.equal(back.keys[0].action, 3);
  assert.equal(back.keys[5].type, 3);
  assert.equal(back.keys[1].key, -2);

  assert.equal(back.macro.count, 1);
  assert.equal(back.macro.slots[0][0].type, 1);
  assert.equal(back.macro.slots[0][0].code1, 0x04);

  assert.deepEqual([...back.light.slice(0, 4)], [0xab, 0xab, 0xab, 0xab]);
});

test("扳机槽 14B 布局编码正确", () => {
  const slot = new Uint8Array(TRIGGER_SLOT_SIZE);
  encodeTriggerSlot(slot, { mode: 3, param1: 7, c: 30, s: 70, curve: [1, 2, 3, 4, 5, 6, 7, 8], c2: 10, s2: 20 });
  assert.equal(slot[0], 3, "mode");
  assert.equal(slot[1], 7, "param1");
  assert.equal(slot[2], 30, "c");
  assert.equal(slot[3], 70, "s");
  assert.equal(slot[4], 1, "curve[0]");
  assert.equal(slot[11], 8, "curve[7]");
  assert.equal(slot[12], 90, "thresholdA = 100-10");
  assert.equal(slot[13], 80, "thresholdB = 100-20");
  const back = decodeTriggerSlot(slot);
  assert.deepEqual(back, { mode: 3, param1: 7, c: 30, s: 70, curve: [1, 2, 3, 4, 5, 6, 7, 8], c2: 10, s2: 20 });
});

test("帧校验公式:check = sum(帧内前置字节) mod 256(真实抓包 9 帧全验证)", () => {
  const frames = BURST0.map((h) => Uint8Array.from(h.split(" ").map((x) => parseInt(x, 16))));
  for (const f of frames) {
    const c = computeFrameChecksum(f, checkPosOf(f));
    assert.equal(c, f[checkPosOf(f)], `seq=${f[3]} 校验字节`);
  }
});

test("真实抓包:dechunkFrames(校验+marker)还原 508B 数据流,解析字段正确", () => {
  const frames = BURST0.map((h) => Uint8Array.from(h.split(" ").map((x) => parseInt(x, 16))));
  const payload = dechunkFrames(frames, { validate: true, marker: 0xd7 });
  assert.equal(payload.length, PAYLOAD_SIZE_VERIFIED, "数据流应为 508B");
  assert.equal(payload.length, PAYLOAD_SIZE);

  const parsed = parseWritePayload(payload);
  // 组0 = 扳机死区:左(下限5, 上限95) 右(下限5, 上限90),抓包确认
  assert.equal(parsed.triggerDeadzone.leftLow, 5);
  assert.equal(parsed.triggerDeadzone.leftHigh, 95);
  assert.equal(parsed.triggerDeadzone.rightLow, 5);
  assert.equal(parsed.triggerDeadzone.rightHigh, 90);
  assert.equal(parsed.header[0], 0x01);
  assert.equal(parsed.header[1], 0xfc);
  assert.equal(parsed.triggers.length, 6);
  // 记录 2(触发索引 2)为曲线记录:01 20 0c 00 ...
  assert.equal(parsed.triggers[2].header[0], 0x01);
  assert.equal(parsed.triggers[2].header[1], 0x20);
  assert.equal(parsed.triggers[2].deadzone, 0x0c);
  assert.equal(parsed.triggers[2].param[0], 0x00);
  // 键位区已知形态(@472)
  assert.deepEqual(parsed.keySection.slice(0, 4), [0x01, 0x0d, 0xff, 0xff]);
});

test("读查询帧固定为 a5 04 d6 7f(抓包验证)", () => {
  assert.equal(READ_QUERY.length, 64);
  assert.equal(READ_QUERY[0], 0xa5);
  assert.equal(READ_QUERY[1], 0x04);
  assert.equal(READ_QUERY[2], 0xd6);
  assert.equal(READ_QUERY[3], 0x7f);
});

test("chunkPayload 分块:508B → 9×64B,重分块还原一致", () => {
  const frames = BURST0.map((h) => Uint8Array.from(h.split(" ").map((x) => parseInt(x, 16))));
  const payload = dechunkFrames(frames);
  const re = chunkPayload(payload, 0xd7);
  assert.equal(re.length, CHUNK_COUNT);
  for (const r of re) assert.equal(r.length, REPORT_SIZE);
  const back = dechunkFrames(re, { validate: true, marker: 0xd7 });
  assert.deepEqual([...back], [...payload], "重组一致");
  // 与抓包帧完全一致(魔数/长度/marker/序号/校验)
  for (let i = 0; i < 9; i++) assert.deepEqual([...re[i]], [...frames[i]]);
});

test("读回 marker d6:校验字节 = 写(d7) - 1(设备行为验证)", () => {
  const frames = BURST0.map((h) => Uint8Array.from(h.split(" ").map((x) => parseInt(x, 16))));
  const payload = dechunkFrames(frames);
  const readBack = chunkPayload(payload, MARKER_READ);
  for (let i = 0; i < 9; i++) {
    const w = frames[i], r = readBack[i];
    const cp = checkPosOf(w);
    assert.equal(r[cp], (w[cp] - 1) & 0xff, `seq=${w[3]} 读回校验-1`);
    assert.equal(r[2], MARKER_READ);
  }
});

test("chunkPadset 兼容:456B → 9×64B(过渡期)", () => {
  const p = sampleProfile();
  const ps = encodeProfile(p);
  const reports = chunkPadset(ps);
  assert.equal(reports.length, CHUNK_COUNT, "应为 9 块");
  for (const r of reports) assert.equal(r.length, REPORT_SIZE, "每块 64B");
  const back = dechunkReports(reports);
  assert.equal(back.length, PAYLOAD_SIZE_VERIFIED, "重组为 508B(padded)");
  assert.deepEqual([...back.slice(0, ps.length)], [...ps], "pad set 部分还原一致");
});

test("边界:空 profile 不抛错", () => {
  const ps = encodeProfile({});
  assert.equal(ps.length, 456);
  const back = decodeProfile(ps);
  assert.equal(back.triggers.length, 6);
  assert.equal(back.keys.length, 32);
});
