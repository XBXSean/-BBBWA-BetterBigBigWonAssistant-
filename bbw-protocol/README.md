# bbw-protocol

BIGBIG WON 手柄配置协议库 —— 通过 WebHID 直接读取/写入手柄配置,无需安装任何驱动。

本项目通过分析官方配置工具的 USB 通信行为,还原了手柄的配置读写协议,并在真机上验证通过。

## 特性

- ✅ 配置读取/写入(508B 写数据流 + 456B 读 pad set 两套格式)
- ✅ 校验算法:CRC-16/MODBUS(poly 0x8005, init 0xFFFF),已破解
- ✅ 扳机死区 / 摇杆曲线(6 槽,每槽 4 曲线点 + 中心/外圈死区 + 稳定系数 + 扩展键映射)
- ✅ 体感(sensorMode / sim_keys / 陀螺仪)、震动、键位映射(32 键 + 宏编码)
- ✅ 键位编码:Windows VK ↔ USB HID 全表映射,组合键/宏 A/宏 B 三种键类型
- ✅ 64B HID 报告分帧/合帧 + 帧校验(9×64B,270 帧抓包验证)

## 模块

| 模块 | 说明 |
|---|---|
| `src/layout.js` | 456B 设备 pad set 布局常量 + 工具 |
| `src/types.js` | 应用 profile 数据模型(JSDoc) |
| `src/encode.js` | profile → 456B pad set |
| `src/decode.js` | 456B pad set → profile |
| `src/write-format.js` | 508B 写数据流序列化(profile 直转 + CRC 校验) |
| `src/keymap.js` | 键位/宏编码纯函数(VK→HID 全表、键码位图、组合/宏编码) |
| `src/chunks.js` | 64B HID 报告分块 + 帧校验 |
| `src/v39-layout.js` | profile ↔ 508B 字段映射表 |
| `src/driver.js` | 驱动编排(写/读 profile 流程,传输可注入,mock 可测) |
| `src/webhid.js` | WebHID 传输层(浏览器专用:连接/选设备/读写) |

## 使用

```js
import { encodeProfile, decodeProfile, chunkPadset, dechunkReports } from "./src/index.js";

const profile = {
  motion: { enumSensorMode: 1, sensorMode: 0, simKeys: [4], xAxisReversal: 0, yAxisReversal: 0 },
  shock: { grade: 3, params: [0, 255, 0, 255] },
  deadzone: { c0: 12, s0: 30, c1: 12, s1: 30 },
  triggers: Array.from({ length: 6 }, () => ({ mode: 0, c: 20, s: 80, curve: [0,0,0,0,0,0,0,0] })),
  keys: Array.from({ length: 32 }, () => ({ key: -2 })),
};

const padset = encodeProfile(profile);          // Uint8Array(456)
const reports = chunkPadset(padset);            // 9 × Uint8Array(64)
const back = dechunkReports(reports);
const decoded = decodeProfile(back);
```

### 508B 直转(写配置主路径)

```js
import { serializeProfile, parseWritePayload } from "./src/write-format.js";

const p = serializeProfile(profile);            // Uint8Array(508),自动算 CRC
const parsed = parseWritePayload(p);
console.log(parsed.checksumOk);                 // true
```

### WebHID 连接(浏览器)

```js
import { connect, Driver } from "./src/webhid.js";

const { transport } = await connect();   // 授权 → 选 MI_02 配置通道
const driver = new Driver(transport);
await driver.writeProfile(profile);      // 写配置
const p = await driver.readProfile();    // 读配置
```

## 协议速览(508B 写数据流)

| 偏移 | 内容 |
|---|---|
| 0..1 | 校验 CRC-16/MODBUS(数据流 [2..507] 原值,高字节写 [0]) |
| 2..4 | 头 `01 fc 00` |
| 4 | hire 位(bit0=左 bit1=右) |
| 5..8 | 扳机死区范围:[5]=左下限 [6]=100-左上限 [7]=右下限 [8]=100-右上限 |
| 12..13 | 功能位 |
| 14..301 | 6 个摇杆曲线槽(48B/槽 @14/62/110/158/206/254,交错 L/R 默认+C1+C2) |
| 304 | sensorMode*16 + enumSensorMode |
| 305..308 | sim_keys 位图(dword LE) |
| 311 | 轴反转/模式位 |
| 312..318 | 陀螺仪 |
| 344..347 | 键位使能位图(dword LE) |
| 352..360 | 震动(raw 9B 透传) |
| 380..507 | 键位槽区 32×4B(槽[0]=键类型 [1..3]=编码) |

## 测试

```sh
npm test   # node --test test/
```

如沙箱/CI 环境不支持 `node --test` 的子进程 spawn,可逐文件运行:

```sh
node test/keymap.test.js
node test/write-format-checksum.test.js
# ...
```

## 已知限制 / 未验证项

1. 65B 报告帧格式(命令头/序号/校验)—— 已通过抓包验证
2. sim_keys 位图多值累积的解码(单键可无损,多键仅取单键)
3. 键槽 i ↔ 键值映射
4. 震动布局 A/B 的设备型号判定(写路径按 raw 9B 透传,不猜布局)
5. 扳机 c/s/c2/s2 的精确语义
6. 灯效区(128B)内容

> ⚠️ 兼容性:协议字段以真机读写验证为准。不同固件版本(v34/v35/v36/v37/v60/v61)布局可能略有差异,键 21..24 位图已按固件类型参数化。
