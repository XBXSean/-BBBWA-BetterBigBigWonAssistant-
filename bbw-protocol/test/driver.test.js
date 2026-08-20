import { test } from "node:test";
import assert from "node:assert/strict";
import { Driver, READ_QUERY } from "../src/driver.js";
import { CHUNK_COUNT, REPORT_SIZE } from "../src/index.js";
import { BURST0 } from "./fixtures-burst0.js";

/** 模拟 MI_02 传输:写报告缓存,读时按设备行为回放(标记 d7→d6,校验-1) */
class MockTransport {
  constructor() {
    this.sent = [];
    this.replay = [];
    this.readRequested = 0;
    this.readQueries = [];
  }
  async sendConfigReport(report) {
    this.sent.push(new Uint8Array(report));
  }
  async requestReadProfile() {
    this.readRequested++;
    this.readQueries.push(READ_QUERY);
    // 模拟设备:写回传数据,marker 改为 d6,校验字节 -1
    this.replay = this.sent.map((r) => {
      const out = new Uint8Array(r);
      out[2] = 0xd6;
      const checkPos = out[1] === 64 ? 63 : 4 + (out[1] - 4) - 1;
      out[checkPos] = (out[checkPos] - 1) & 0xff;
      return out;
    });
  }
  async nextConfigReport() {
    if (this.replay.length === 0) throw new Error("无回放数据");
    return this.replay.shift();
  }
}

function sampleProfile() {
  return {
    motion: { enumSensorMode: 1, sensorMode: 2, simKeys: [4], gyroA: 60 },
    shock: { grade: 3, params: [0, 255, 0, 255] },
    deadzone: { c0: 12, s0: 30, c1: 12, s1: 30 },
    triggers: Array.from({ length: 6 }, (_, i) => ({
      mode: i % 4, c: 10 + i, s: 90 - i, curve: [0, 0, 0, 0, 0, 0, 0, 0],
    })),
    keys: Array.from({ length: 32 }, () => ({ key: -2 })),
  };
}

test("Driver.writeProfile 发送 9 个 64B 报告(真实帧格式)", async () => {
  const t = new MockTransport();
  const d = new Driver(t);
  await d.writeProfile(sampleProfile());
  assert.equal(t.sent.length, CHUNK_COUNT, `应发 ${CHUNK_COUNT} 块`);
  for (const r of t.sent) {
    assert.equal(r.length, REPORT_SIZE, `每块 ${REPORT_SIZE}B`);
    assert.equal(r[0], 0xa4, "魔数");
    assert.equal(r[2], 0xd7, "写 marker");
  }
});

test("Driver 写→读 往返:传输层字段一致(marker/校验)", async () => {
  const t = new MockTransport();
  const d = new Driver(t);
  await d.writeProfile(sampleProfile());
  await d.readProfile();
  assert.equal(t.readRequested, 1);
  assert.deepEqual([...t.readQueries[0]], [...READ_QUERY], "读查询帧正确");
});

test("Driver.readProfile 解析真实抓包数据(死区 5-95)", async () => {
  // 用真实抓包的第一轮写突发作为"设备当前配置"的回放
  const t = new MockTransport();
  t.sent = BURST0.map((h) =>
    Uint8Array.from(h.split(" ").map((x) => parseInt(x, 16))));
  const d = new Driver(t);
  const parsed = await d.readProfile();
  assert.equal(parsed.triggerDeadzone.leftLow, 5);
  assert.equal(parsed.triggerDeadzone.leftHigh, 95);
  assert.equal(parsed.triggerDeadzone.rightLow, 5);
  assert.equal(parsed.triggerDeadzone.rightHigh, 90);
  assert.equal(parsed.triggers.length, 6);
});

test("webhid 模块纯逻辑(不触浏览器)可选设备", async () => {
  const fakeConfig = {
    collections: [{ usagePage: 0xff7a, outputReports: [{ reportLength: 64 }], inputReports: [{ reportLength: 64 }] }],
  };
  const fakeInput = {
    collections: [{ usagePage: 0x0001, usage: 0x05, outputReports: [], inputReports: [{ reportLength: 15 }] }],
  };
  const fakeCmd = {
    collections: [{ usagePage: 0xffb1, outputReports: [{ reportLength: 12 }] }],
  };
  const { pickConfigDevice, pickInputDevice, pickCmdDevice } = await import("../src/webhid.js");
  assert.equal(pickConfigDevice([fakeInput, fakeConfig, fakeCmd]), fakeConfig);
  assert.equal(pickInputDevice([fakeInput, fakeConfig]), fakeInput);
  assert.equal(pickCmdDevice([fakeCmd, fakeConfig]), fakeCmd);
});
