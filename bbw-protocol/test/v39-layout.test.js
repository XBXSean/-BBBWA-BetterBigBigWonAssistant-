// v39 布局验证测试:唯一值样本(src-unique-values / src-dz30-07)
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { parseWritePayload, serializeWritePayload } from "../src/write-format.js";

const parse = (f) => Buffer.from(readFileSync(f, "utf8").match(/0x[0-9a-f]+/gi).map(x => parseInt(x, 16))).subarray(0, 508);
const A = parse(new URL("./fixtures/src-unique-values.hex", import.meta.url));
const B = parse(new URL("./fixtures/src-dz30-07.hex", import.meta.url));

test("A 组(左扳机15? 右扳机2..43): [5..8] 死区范围解析", () => {
  const p = parseWritePayload(A);
  assert.equal(p.triggerDeadzone.leftLow, 15);
  assert.equal(p.triggerDeadzone.rightLow, 2);
  assert.equal(p.triggerDeadzone.rightHigh, 43); // [8]=57=100-43
  assert.equal(p.header[0], 0xfc); // src 构建前头
  assert.equal(p.sensorModeByte, 0);
  assert.equal(p.featFlags[0], 0x66);
});

test("B 组(左6..14 右25..31): 上限补码验证", () => {
  const p = parseWritePayload(B);
  assert.equal(p.triggerDeadzone.leftHigh, 14);  // [6]=86=100-14
  assert.equal(p.triggerDeadzone.rightHigh, 31); // [8]=69=100-31
  assert.equal(p.triggerDeadzone.leftLow, 8);
  assert.equal(p.triggerDeadzone.rightLow, 23);
});

test("序列化:改扳机死区范围 → 校验重算,字段写入正确", () => {
  const s = serializeWritePayload({ from: A, triggerDeadzone: { leftLow: 6, leftHigh: 14, rightLow: 25, rightHigh: 31 } });
  const p = parseWritePayload(s);
  assert.equal(p.checksumOk, true);
  assert.equal(p.triggerDeadzone.leftLow, 6);
  assert.equal(p.triggerDeadzone.leftHigh, 14);
  assert.equal(p.triggerDeadzone.rightLow, 25);
  assert.equal(p.triggerDeadzone.rightHigh, 31);
  // 除校验+死区外其他字段保留
  assert.equal(s[12], A[12]); // 功能位保留
  assert.equal(s[304], A[304]);
});
