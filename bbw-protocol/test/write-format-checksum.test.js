// [0..1] 校验算法验证 —— CRC-16/MODBUS(数据流[2..507]) 原值
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { computePayloadChecksum, crc16Modbus, serializeWritePayload } from "../src/write-format.js";

// 死区95 实时缓冲(抓包样本,零转录误差):
// 512B = a4 d7 fc 01 + [4..5](写回前旧值) + [6..511](真实内容)
// crc16 覆盖 [6..511] → 软件写回 [4..5] = [crc 高字节, crc 低字节]
const h = readFileSync(new URL("./fixtures/deadzone95-raw.hex", import.meta.url), "utf8");
const b = Buffer.from(h.match(/0x[0-9a-f]+/gi).map(x => parseInt(x, 16)));
assert.equal(b.length, 512);

test("crc16Modbus([6..511]) = 0xDB00(与历史死区95→DB 00 完全一致)", () => {
  const crc = crc16Modbus(b.subarray(6, 512));
  assert.equal(crc, 0xdb00);
});

test("computePayloadChecksum(数据流) = 0xDB00(数据流 = 缓冲[4..511])", () => {
  const dataStream = b.subarray(4, 512); // 508B
  const cs = computePayloadChecksum(dataStream);
  assert.equal(cs, 0xdb00);
});

test("软件写回格式:[4..5] = [crc>>8, crc&0xff] = DB 00", () => {
  const cs = computePayloadChecksum(b.subarray(4, 512));
  assert.equal((cs >> 8) & 0xff, 0xdb);
  assert.equal(cs & 0xff, 0x00);
});

test("serializeWritePayload 写回校验后自洽(校验字段 = CRC)", () => {
  const p = serializeWritePayload();
  const cs = computePayloadChecksum(p);
  assert.equal(p[0], (cs >> 8) & 0xff);
  assert.equal(p[1], cs & 0xff);
});

test("校验对内容敏感(改死区会改变校验)", () => {
  const p = serializeWritePayload();
  const before = computePayloadChecksum(p);
  p[20] = 0x5f; // 死区 95
  const after = computePayloadChecksum(p);
  assert.notEqual(before, after);
});
