/**
 * WebHID 传输层(浏览器专用)
 *
 * 手柄(VID 0x413D / PID 0x2104)每个 HID 接口在浏览器里是独立 HIDDevice:
 * - MI_02   : 供应商页 0xFF7A,64B 报告(ID 0)→ 主配置通道(Driver 用)
 * - MI_01&Col03: 13B Out,UP 0xFFB1 → 命令通道(未使用,读走配置通道)
 * - IG_00   : 15B In,UP 0x01/0x05 → 游戏输入
 *
 * 帧格式已由 USB 抓包验证:
 * - 写:a4 <len> d7 <seq> + 载荷(9×64B)
 * - 读:发 a5 04 d6 7f(64B)→ 收 a4 <len> d6 <seq> × 9
 */

export const VID = 0x413d;
export const PID = 0x2104;
export const CONFIG_USAGE_PAGE = 0xff7a; // MI_02
export const CMD_USAGE_PAGE = 0xffb1;    // MI_01&Col03
export const GAME_USAGE_PAGE = 0x0001;   // IG_00

/** 浏览器是否支持 WebHID */
export function isSupported() {
  return typeof navigator !== "undefined" && "hid" in navigator;
}

/** 请求授权并返回全部 HID 接口设备 */
export async function requestDevices() {
  if (!isSupported()) throw new Error("WebHID 不受支持");
  return navigator.hid.requestDevice({ filters: [{ vendorId: VID, productId: PID }] });
}

/** 挑选配置通道设备(MI_02:供应商页 0xFF7A,存在输出报告;用 usagePage 判定) */
export function pickConfigDevice(devices) {
  return (
    devices.find((d) =>
      d.collections.some((c) => c.usagePage === CONFIG_USAGE_PAGE && c.outputReports.length > 0),
    ) ?? null
  );
}

/** 挑选游戏输入设备(IG_00:Generic Desktop / usage 5 = Game Pad) */
export function pickInputDevice(devices) {
  return (
    devices.find((d) =>
      d.collections.some((c) => c.usagePage === GAME_USAGE_PAGE && c.usage === 0x05),
    ) ?? null
  );
}

/** 挑选命令通道设备(Col03:UP 0xFFB1) */
export function pickCmdDevice(devices) {
  return (
    devices.find((d) =>
      d.collections.some((c) => c.usagePage === CMD_USAGE_PAGE),
    ) ?? null
  );
}

/**
 * WebHID 传输实现(Driver 的 transport 参数)。
 */
export class WebHidTransport {
  /**
   * @param {HIDDevice} configDevice  MI_02 设备
   * @param {HIDDevice} [cmdDevice]   Col03 命令设备
   * @param {HIDDevice} [inputDevice] IG_00 游戏输入设备
   */
  constructor(configDevice, cmdDevice = null, inputDevice = null) {
    this.config = configDevice;
    this.cmd = cmdDevice;
    this.input = inputDevice;
    this._inputQueue = [];
    this._inputWaiters = [];
    this._bind();
  }

  _bind() {
    if (this.config) {
      this.config.addEventListener("inputreport", (e) => this._pushInput(e));
    }
    if (this.input) {
      this.input.addEventListener("inputreport", (e) => this._pushInput(e));
    }
  }

  _pushInput(e) {
    const bytes = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
    const waiter = this._inputWaiters.shift();
    if (waiter) waiter(bytes);
    else this._inputQueue.push(bytes);
  }

  /**
   * 发 64B 配置报告。
   * 注意:MI_02 的报告 ID 为 0(无 ID 字节),data = 整帧 64B。
   * @param {Uint8Array} report 64B 帧(a4 ...)
   */
  async sendConfigReport(report) {
    if (!this.config) throw new Error("配置通道未连接");
    // TODO(validate): 若真机报告 ID ≠ 0,改为 sendReport(id, report)
    await this.config.sendReport(0, report);
  }

  /** 发起读配置:发固定查询帧 a5 04 d6 7f(64B) */
  async requestReadProfile() {
    if (!this.config) throw new Error("配置通道未连接");
    const { READ_QUERY } = await import("./chunks.js");
    await this.config.sendReport(0, READ_QUERY);
  }

  /** 取下一个 64B 配置输入报告 */
  async nextConfigReport() {
    const bytes = await this._nextInput();
    if (bytes.length < 64) {
      throw new Error(`配置输入报告长度异常:${bytes.length}`);
    }
    return bytes.subarray(0, 64);
  }

  /** 取下一个游戏输入报告(15B) */
  async nextInputReport() {
    return this._nextInput();
  }

  _nextInput() {
    if (this._inputQueue.length > 0) return Promise.resolve(this._inputQueue.shift());
    return new Promise((resolve) => this._inputWaiters.push(resolve));
  }

  async close() {
    for (const d of [this.config, this.cmd, this.input]) {
      if (d && d.opened) await d.close();
    }
  }
}

/**
 * 一键连接:请求授权 → 挑选设备 → 组装传输。
 * @returns {Promise<{transport: WebHidTransport, devices: HIDDevice[]}>}
 */
export async function connect() {
  const devices = await requestDevices();
  if (devices.length === 0) throw new Error("未找到手柄 HID 接口");
  const config = pickConfigDevice(devices);
  if (!config) throw new Error("未找到配置通道(MI_02)");
  const cmd = pickCmdDevice(devices);
  const input = pickInputDevice(devices);
  await config.open();
  if (cmd && !cmd.opened) await cmd.open();
  if (input && !input.opened) await input.open();
  return { transport: new WebHidTransport(config, cmd, input), devices };
}
