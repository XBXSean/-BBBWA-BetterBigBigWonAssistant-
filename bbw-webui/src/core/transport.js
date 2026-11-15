/**
 * 传输层：真机 / 模拟两种来源，上层代码完全一致。
 *
 * 真机：WebHID → MI_02 (usagePage 0xFF7A) 配置通道，65B 报告（1B reportId + 64B 载荷）。
 * 模拟：core/mock-hid.js 顶替 navigator.hid，协议行为一致。
 */
import { chunkPayload, dechunkFrames, READ_QUERY, MARKER_READ } from "../../../bbw-protocol/src/index.js";
import { installMockHid, uninstallMockHid } from "./mock-hid.js";

const VID = 0x413d;
const PID = 0x2104;
const CONFIG_UP = 0xff7a;

export class Transport {
  constructor() {
    this.device = null;
    this.gamepad = null;
    this.mock = false;
    this.info = null;
    this.queue = [];
    this.waiters = [];
    this.gpCbs = [];
  }

  get connected() { return !!this.device; }

  async connect({ mock = false } = {}) {
    if (mock) {
      installMockHid();
      this.mock = true;
    } else {
      uninstallMockHid();
      this.mock = false;
      if (!("hid" in navigator)) throw new Error("当前浏览器不支持 WebHID，请用 Chrome/Edge 89+ 或开启模拟模式");
    }

    const picked = await navigator.hid.requestDevice({
      filters: [{ vendorId: VID, productId: PID }],
    });
    if (!picked.length) throw new Error("没有选择设备");

    const config = picked.find((d) =>
      d.collections?.some((c) => c.usagePage === CONFIG_UP && (c.outputReports?.length ?? 0) > 0));
    if (!config) throw new Error("未找到配置通道（usagePage 0xFF7A 的 MI_02 接口）");

    this.queue = [];
    this.waiters = [];
    this.gpCbs = [];

    await config.open();
    this.device = config;
    config.addEventListener("inputreport", (e) => {
      const b = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
      if (b.length < 64 || b[0] !== 0xa4) {
        for (const cb of this.gpCbs) cb(b);
        return;
      }
      const w = this.waiters.shift();
      if (w) w(b); else this.queue.push(b);
    });

    // 游戏输入接口（真机才有）：用于「按一下学习」与实时摇杆
    const gp = picked.find((d) => d !== config &&
      d.collections?.some((c) => c.usagePage === 0x01 && c.usage === 0x05));
    if (gp) {
      try {
        await gp.open();
        this.gamepad = gp;
        gp.addEventListener("inputreport", (e) => {
          const b = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
          for (const cb of this.gpCbs) cb(b);
        });
      } catch { this.gamepad = null; }
    }

    this.info = {
      productName: config.productName || "BIGBIG WON",
      vendorId: config.vendorId, productId: config.productId,
      serialNumber: config.serialNumber || "",
      mock: this.mock,
      hasGamepad: !!this.gamepad,
    };
    return this.info;
  }

  disconnect() {
    try { this.device?.close(); } catch {}
    try { this.gamepad?.close(); } catch {}
    this.device = null;
    this.gamepad = null;
    if (this.mock) { uninstallMockHid(); this.mock = false; }
  }

  onGamepad(cb) {
    this.gpCbs.push(cb);
    return () => { const i = this.gpCbs.indexOf(cb); if (i >= 0) this.gpCbs.splice(i, 1); };
  }

  nextInput(timeout = 3000) {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("等待设备响应超时")), timeout);
      this.waiters.push((b) => { clearTimeout(t); res(b); });
    });
  }

  async readProfile() {
    if (!this.device) throw new Error("设备未连接");
    this.queue = [];
    await this.device.sendReport(0, READ_QUERY);
    const frames = new Map();
    const deadline = Date.now() + 4000;
    while (frames.size < 9 && Date.now() < deadline) {
      const b = await this.nextInput(Math.max(50, deadline - Date.now()));
      if (b.length < 64 || b[0] !== 0xa4 || b[2] !== MARKER_READ) continue;
      frames.set(b[3], b);
    }
    if (frames.size < 9) throw new Error(`只收到 ${frames.size}/9 帧，设备无响应`);
    const sorted = [...frames.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    const payload = dechunkFrames(sorted, { marker: MARKER_READ, validate: false });
    if (payload.length !== 508) throw new Error(`数据流长度异常 ${payload.length}B`);
    return payload;
  }

  async writeProfile(payload) {
    if (!this.device) throw new Error("设备未连接");
    const frames = chunkPayload(payload, 0xd7);
    for (const f of frames) await this.device.sendReport(0, f);
    await new Promise((r) => setTimeout(r, 260)); // 真机落盘后再读回
  }
}
