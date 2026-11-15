/**
 * 模拟 WebHID 设备 —— 让「没插手柄」也能完整走真实代码路径。
 *
 * 做法：把 navigator.hid 换成一个最小实现，返回一台假的 0x413D:0x2104，
 * 它按真机协议收发（读 a5 04 d6 7f → 9×64B a4..d6；写 9×64B a4..d7 累积成 508B），
 * 并且**真的校验**帧校验字节与 CRC-16/MODBUS —— 应用层写错就写不进去，
 * 这样模拟模式不会掩盖协议层 bug。
 *
 * 配置存在 localStorage，刷新页面后还在，可随时「恢复出厂」。
 */
import {
  chunkPayload, dechunkFrames, READ_QUERY, MARKER_READ, MARKER_WRITE,
  computePayloadChecksum, crc16Modbus,
} from "../../../bbw-protocol/src/index.js";
import { DEFAULT_508 } from "./default-config.js";

const LS_KEY = "bbw-mock-508";
const VID = 0x413d;
const PID = 0x2104;

/* ---------------- 状态 ---------------- */

const listeners = new Set();
export const mockLog = [];

function emit() { for (const fn of listeners) fn(); }
export function onMockChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function log(kind, text) {
  mockLog.push({ t: Date.now(), kind, text });
  if (mockLog.length > 200) mockLog.splice(0, mockLog.length - 200);
  emit();
}

function loadPayload() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length === 508) return Uint8Array.from(arr);
    }
  } catch {}
  return Uint8Array.from(DEFAULT_508);
}

function savePayload(p) {
  try { localStorage.setItem(LS_KEY, JSON.stringify([...p])); } catch {}
}

export function mockReset() {
  const d = Uint8Array.from(DEFAULT_508);
  const cs = computePayloadChecksum(d);
  d[0] = (cs >> 8) & 0xff; d[1] = cs & 0xff;
  savePayload(d);
  if (device) device.payload = d;
  log("info", "模拟设备已恢复出厂默认配置");
  return d;
}

/* ---------------- 假设备 ---------------- */

let device = null;

class MockDevice extends EventTarget {
  constructor() {
    super();
    this.vendorId = VID;
    this.productId = PID;
    this.productName = "BIGBIG WON 彩虹3";
    this.serialNumber = "MOCK-508B";
    this.opened = false;
    this.payload = loadPayload();
    this.collections = [
      {
        usagePage: 0xff7a, usage: 0x01,
        inputReports: [{ reportId: 0, reportLength: 64 }],
        outputReports: [{ reportId: 0, reportLength: 64 }],
      },
      {
        usagePage: 0x0001, usage: 0x0005,
        inputReports: [{ reportId: 0, reportLength: 15 }],
        outputReports: [],
      },
    ];
    this._buf = new Map();
  }

  async open() {
    if (this.opened) throw new DOMException("The device is already open.", "InvalidStateError");
    this.opened = true;
    log("ok", "设备已打开（模拟）");
  }

  async close() {
    this.opened = false;
    log("info", "设备已关闭");
  }

  _emit(frame) {
    const data = new Uint8Array(frame); // 独立缓冲
    const ev = new Event("inputreport");
    ev.data = new DataView(data.buffer);
    ev.reportId = 0;
    ev.source = this;
    this.dispatchEvent(ev);
  }

  /** 真机行为：a5 04 d6 7f → 回 9 帧；a4..d7 累积 9 帧 → 落盘 */
  async sendReport(reportId, bytes) {
    const f = Uint8Array.from(bytes);
    if (!this.opened) throw new DOMException("The device is not opened.", "InvalidStateError");

    if (f[0] === 0xa5 && f[2] === 0xd6) {
      const frames = chunkPayload(this.payload, MARKER_READ);
      let i = 0;
      const tick = () => {
        if (i >= frames.length || !this.opened) return;
        this._emit(frames[i++]);
        setTimeout(tick, 4);
      };
      tick();
      return;
    }

    if (f[0] === 0xa4 && f[2] === MARKER_WRITE) {
      this._buf.set(f[3], f);
      if (this._buf.size >= 9) {
        const frames = [...this._buf.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1]);
        this._buf = new Map();
        this._commit(frames);
      }
      return;
    }

    log("warn", `未知报告 0x${f[0].toString(16)}，已忽略`);
  }

  _commit(frames) {
    let payload;
    try {
      payload = dechunkFrames(frames, { marker: MARKER_WRITE, validate: true });
    } catch (e) {
      log("err", `写入被拒：帧校验失败（${e.message}）`);
      return;
    }
    const want = computePayloadChecksum(payload);
    const got = (payload[0] << 8) | payload[1];
    if (want !== got) {
      log("err", `写入被拒：CRC 不符（载荷 0x${got.toString(16)},算得 0x${want.toString(16)}）`);
      return;
    }
    const prev = this.payload;
    const changed = [];
    for (let i = 0; i < 508; i++) if (prev[i] !== payload[i]) changed.push(i);
    this.payload = payload;
    savePayload(payload);
    const reenum = prev[304] !== payload[304];
    log("ok", `配置已写入（${changed.length} 字节变化${reenum ? "，[304] 变更 → 真机会重枚举" : ""}）`);
  }
}

class MockHid extends EventTarget {
  constructor() {
    super();
    this.onconnect = null;
    this.ondisconnect = null;
  }
  async getDevices() { return device && device.opened ? [device] : (device ? [device] : []); }
  async requestDevice() {
    device = device || new MockDevice();
    log("info", "requestDevice() → 返回模拟设备");
    return [device];
  }
}

let mockHid = null;
let savedHid;

export function installMockHid() {
  if (mockHid) return mockHid;
  device = new MockDevice();
  mockHid = new MockHid();
  savedHid = Object.getOwnPropertyDescriptor(navigator, "hid");
  Object.defineProperty(navigator, "hid", { value: mockHid, configurable: true, writable: true });
  log("info", "已挂载模拟 WebHID（navigator.hid 被替换）");
  return mockHid;
}

export function uninstallMockHid() {
  if (!mockHid) return;
  try { device?.close(); } catch {}
  if (savedHid) Object.defineProperty(navigator, "hid", savedHid);
  else delete navigator.hid;
  mockHid = null;
  device = null;
  log("info", "已卸载模拟 WebHID");
}

export const isMockInstalled = () => !!mockHid;
export const mockPayload = () => (device ? device.payload : loadPayload());
export const mockCrc = () => {
  const p = device ? device.payload : loadPayload();
  return crc16Modbus(p.subarray(2));
};
