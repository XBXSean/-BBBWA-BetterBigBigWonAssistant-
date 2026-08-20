/**
 * 驱动编排层:profile 读写协议流程(与具体传输解耦,可用 mock 测试)
 *
 * 传输接口(transport):
 *   sendConfigReport(report: Uint8Array): Promise<void>   // 64B 帧
 *   requestReadProfile(): Promise<void>                    // 发读查询(见下)
 *   nextConfigReport(): Promise<Uint8Array>                // 取下一个 64B 输入帧
 *
 * 已验证流程:
 *   写:profile → serializeProfile → 508B 数据流
 *      → chunkPayload(marker=d7) → 9×64B OUT
 *   读:发 64B 查询帧 a5 04 d6 7f → 设备回 9×64B(a4 40 d6 01..09)
 *      → dechunkFrames → 508B 数据流 → parseWritePayload
 */
import { encodeProfile } from "./encode.js";
import { decodeProfile } from "./decode.js";
import { chunkPayload, dechunkFrames, CHUNK_COUNT, MARKER_WRITE, READ_QUERY } from "./chunks.js";
import { serializeProfile, serializeWritePayload, parseWritePayload } from "./write-format.js";

export class Driver {
  /**
   * @param {object} transport
   */
  constructor(transport) {
    this.transport = transport;
  }

  /**
   * 写配置:profile → 508B 序列化(v39 直转)→ 9×64B 帧。
   * @param {import('./types.js').AppProfile} profile
   * @param {object} [opts]
   * @param {Uint8Array} [opts.from] 已有 508B(读-改-写保留其他字段)
   */
  async writeProfile(profile, opts = {}) {
    const payload = serializeProfile(profile, opts.from ?? null);
    const reports = chunkPayload(payload, MARKER_WRITE);
    for (const r of reports) {
      await this.transport.sendConfigReport(r);
    }
  }

  /**
   * 读配置:发查询帧 → 收集 9×64B 帧 → 508B 数据流 → 解析。
   * @returns {Promise<ReturnType<typeof parseWritePayload>>}
   */
  async readProfile() {
    await this.transport.requestReadProfile();
    const frames = [];
    for (let i = 0; i < CHUNK_COUNT; i++) {
      frames.push(await this.transport.nextConfigReport());
    }
    const payload = dechunkFrames(frames, { validate: true, marker: 0xd6 });
    return parseWritePayload(payload);
  }

  /**
   * 读游戏输入(IG_00 通道,15B 输入报告)。
   * @returns {Promise<Uint8Array|null>} 原始输入报告(解析留给 UI 层)
   */
  async readGameInput() {
    if (typeof this.transport.nextInputReport !== "function") return null;
    return this.transport.nextInputReport();
  }
}

export { READ_QUERY };
