# bbw-protocol

BIGBIG WON 手柄（彩虹 3，VID `0x413D` / PID `0x2104`）配置协议库。纯 WebHID，可直接在浏览器里读写手柄配置。

协议通过分析官方配置工具的 USB 通信与静态逆向得到，字段语义以真机读写验证为准，未验证项在 [`../docs/508B-field-map.md`](../docs/508B-field-map.md) 里单独标注。

## 传输模型

| 层 | 规格 |
|---|---|
| 配置通道 | MI_02，`usagePage 0xFF7A`，64 字节报告（report ID 0） |
| 读取 | 发送 `a5 04 d6 7f`，设备回 9 帧 `a4 <len> d6 <seq>` |
| 写入 | 9 帧 `a4 <len> d7 <seq>`，每帧 64 字节 |
| 分块 | 8 × 59B + 末块 36B = 508B |
| 帧校验 | 帧内数据字节求和 mod 256 |
| 载荷 | 508B，`[0..1]` = CRC-16/MODBUS（覆盖 `[2..507]`） |

## 模块

| 文件 | 作用 |
|---|---|
| `src/chunks.js` | 分帧 / 合帧、帧校验、读取查询帧 |
| `src/write-format.js` | 508B 语义解析与序列化、CRC、摇杆径向曲线求值 |
| `src/layout.js` | 字段偏移常量、扳机槽、`sim_keys` 位表 |
| `src/v39-layout.js` | 应用 profile 偏移 ↔ 508B 偏移对照 |
| `src/encode.js` / `src/decode.js` | 456B pad set 模型（旧链路，保留兼容） |
| `src/driver.js` | 读写编排，传输可注入，便于测试 |
| `src/webhid.js` | 浏览器端 WebHID 传输层 |
| `src/keymap.js` | 键位编码与名称表 |

## 用法

```js
import { connect } from "./src/webhid.js";
import { Driver } from "./src/driver.js";

const { transport } = await connect();   // 授权 → 选配置通道
const driver = new Driver(transport);

const payload = await driver.readProfile();   // Uint8Array(508)
await driver.writeProfile(payload);           // 写入时重算 CRC
```

直接操作字节：

```js
import {
  parseWritePayload, serializeWritePayload, applyJoystickCurve,
} from "./src/write-format.js";

const cfg = parseWritePayload(bytes);          // 解析成结构化字段
const out = serializeWritePayload({ from: bytes, triggerDeadzone: { leftLow: 8 } });
// 未触及的字段原样保留，CRC 重新计算
```

## 摇杆模型

真机是**径向**的：先算推杆距离 `r = hypot(x, y) / 32767 × 100`，`r ≤ 死区` 归零，再按 5 点分段线性查表得到输出模长，方向保持不变。

```js
import { applyJoystickCurve } from "./src/write-format.js";

const { x, y } = applyJoystickCurve(0, lx, ly);   // slot 0 = 左摇杆
```

## 命令行工具

`tools/` 下是逆向与真机验证时用的脚本，不属于运行时依赖。

| 工具 | 用途 |
|---|---|
| `pad.mjs` | 无头 HID CLI：`list` / `selftest` / `read` / `write` / `sweep` / `probe` / `input` |
| `patch-test.mjs` | 多组参数差分写入，带基线漂移守卫 |
| `axis-invert-test.mjs` | 体感轴反转位测试 |
| `motion-watch.mjs` / `motion-sweep.mjs` | 体感输出实时观察与参数扫描 |
| `deadzone-scan.mjs` / `trig-measure.mjs` / `measure-trigger.mjs` | 扳机死区扫描 |
| `xinput-sample.py` | 读 XInput 摇杆/扳机采样（自动探测槽位） |

这些脚本需要真机与 `node-hid`。`pad.mjs selftest` 需要官方软件目录下的 `DefaultConfig.ini`，用环境变量指定：

```sh
BBW_DEFAULT_INI="/path/to/BIGBIG WON/DefaultConfig.ini" node tools/pad.mjs selftest
```

`pad.mjs` 不实现任何震动测试命令；写入时若震动区间与基线不同会直接拒绝，需要显式 `--allow-shock`。

## 测试

```sh
npm test
```

64 项，覆盖 CRC、分帧合帧、扳机死区与微动、摇杆径向曲线、键位编码、序列化回环。
