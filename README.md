# Better BigBig Won Assistant

> BIGBIG WON 手柄的第三方开源配置工具 —— 纯 WebHID 网页驱动,免驱动、免安装官方软件。

本项目通过分析官方配置工具的 USB 通信协议,实现了对手柄配置的**直接读取与写入**,并提供了一个开箱即用的**网页配置器**(Vue 3 + Vite),支持浏览器直连手柄调参。

## ✨ 特性

- 🔌 **纯 WebHID 直驱**:无需安装驱动,浏览器授权即可连接(Chrome / Edge)
- 📖 **协议逆向**:校验算法(CRC-16/MODBUS)已破解,配置读写全链路真机验证
- 🎮 **网页配置器**(`bbw-webui/`):
  - 连接设备 + 自动读取 + 写入后自动回读验证
  - **按键映射**:有效键位表(按键码 0..24 升序、无效槽位隐藏、键名已固化)+ 物理按键学习(写测定位 / Gamepad API / HID 原始报告三种模式)
  - **扳机设置**:左右扳机死区范围 + hire 位 + 功能位
  - **摇杆设置**:左右摇杆中心/外圈死区 + 6 个曲线槽(4 点拖拽 + 表格精确输入 + 上限 + 稳定系数 + 扩展键映射)
  - **体感震动**:sensorMode / sim_keys / 陀螺仪 / 震动参数
  - **配置管理**:配置列表(本地命名保存多个配置、文件导入导出)+ profile JSON 备份 + 508B hex + 本地校验
- 🧩 **协议库**(`bbw-protocol/`):独立 npm 模块,可被其他项目复用,40 项单元测试覆盖

## 🖥️ 支持的设备

> ⚠️ **兼容性提示**:本项目基于**墨将彩虹三(BIGBIG WON RAINBOW 3)**手柄进行开发与真机验证,协议字段以该型号实测为准。**不保证对其它墨将(BIGBIG WON)手柄型号的兼容性**,使用其它型号前请先读取配置确认解析正确,并做好配置备份。

| 项目 | 值 |
|---|---|
| 开发/验证型号 | 墨将彩虹三(BIGBIG WON RAINBOW 3) |
| 厂商 ID (VID) | `0x413D` |
| 产品 ID (PID) | `0x2104` |
| 配置通道 | MI_02(usagePage `0xFF7A`,64B 报告) |
| 游戏输入通道 | IG_00(15B 输入报告) |

> 协议以真机读写验证为准。不同固件版本的布局可能有差异,键 21..24 位图已按固件类型参数化。

## 🚀 快速开始

### 方式一:直接使用网页版(推荐)

需要先构建 `bbw-webui`(或直接使用已构建的 `dist/`),然后用任意静态服务器托管:

```sh
# 1. 构建网页配置器
cd bbw-webui
npm install
npm run build        # 产物在 bbw-webui/dist/

# 2. 托管到静态服务器(示例:Python)
cd ..
python -m http.server 8080 --bind 127.0.0.1

# 3. 浏览器打开(需 Chrome / Edge,支持 WebHID)
#    http://127.0.0.1:8080/bbw-webui/dist/
```

连接步骤:

1. 打开页面 → 「连接设备」→ 点击「请求授权并连接」
2. 在系统弹窗中选择你的 BIGBIG WON 手柄
3. 连接后自动读取当前配置,即可开始调参
4. 修改后点「写入」,工具会自动回读验证

> ⚠️ WebHID 需要 HTTPS 或 localhost。本地用 `http://127.0.0.1` 即可;部署到公网请使用 HTTPS。

也可以直接访问 **https://xbxsean.github.io/-BBBWA-BetterBigBigWonAssistant-/** 使用

### 方式二:作为库使用

```js
import { connect, Driver } from "./bbw-protocol/src/webhid.js";

const { transport } = await connect();      // 授权 → 选配置通道
const driver = new Driver(transport);

const profile = {
  deadzone: { c0: 12, s0: 30, c1: 12, s1: 30 },   // 扳机死区
  curves: Array.from({ length: 6 }, () => ({       // 摇杆曲线槽
    center: [12, 0],
    points: [20, 20, 40, 40, 60, 60, 80, 80],      // 4 曲线点
    outerDz: 5, maxOut: 100, stabilize: 1,
  })),
  keys: Array.from({ length: 32 }, () => null),    // 键位
};

await driver.writeProfile(profile);   // 写入(自动算 CRC)
const readBack = await driver.readProfile();  // 读回验证
```

详细 API 见 [`bbw-protocol/README.md`](bbw-protocol/README.md)。

## 📁 目录结构

```
BetterBigBigWonAssistant/
├── bbw-protocol/          # 协议库(WebHID 驱动 + 序列化 + 校验 + 键位编码)
│   ├── src/               # 源码(layout/encode/decode/write-format/keymap/chunks/driver/webhid)
│   └── test/              # 40 项单元测试(含真实抓包样本)
├── bbw-webui/             # 网页配置器(Vue 3 + Vite)
│   └── src/               # 视图/组件/状态/WebHID 传输层
└── README.md              # 本文档
```

## 🧪 运行测试

```sh
cd bbw-protocol
npm test
# 或逐文件运行(某些环境 node --test 的子进程 spawn 受限):
node test/keymap.test.js
node test/write-format-checksum.test.js
```

## 📚 协议要点(摘要)

- **写数据流**:508 字节;`[0..1]` = CRC-16/MODBUS(覆盖 `[2..507]`),`[5..8]` = 扳机死区,`[14..301]` = 6 个摇杆曲线槽(48B/槽),`[380..507]` = 32 个键位槽(4B/槽)
- **传输**:64B HID 报告分块,每轮 9 帧(8×59B + 末块 36B),帧校验 = 前置字节和 mod 256
- **读取**:发送固定查询帧 `a5 04 d6 7f`,设备回 9 帧重组

完整布局见 `bbw-protocol/src/write-format.js` 顶部注释与 `bbw-protocol/README.md`。

## ⚠️ 安全须知

1. 本项目**仅做配置读写**,**不包含也不支持固件升级/刷写**功能
2. 写入前请先「读取」当前配置作为基线(工具内置备份页可导出 JSON / hex)
3. 如遇异常,可用「配置备份 → 导入」恢复之前导出的配置
4. 使用风险自负,请勿在固件升级过程中使用本工具

## 🤝 贡献

欢迎提交 Issue / PR,包括但不限于:

- 补充其他固件版本 / 型号的布局差异
- 摇杆响应曲线区 `[309..343]` 的解析(目前 raw 透传)
- 键位表补充(键 0..2 在部分设备上可能为无效键)
- UI 打磨、本地化、构建流程改进

提交 Issue 时请附上:设备型号、固件版本、操作步骤与日志(网页右上角「日志」可复制)。

## ⚖️ 免责声明

本项目为独立开源项目,与 BIGBIG WON 厂商无任何关联,未使用或分发厂商的任何专有代码/资源。协议信息通过分析 USB 通信获得,仅供学习与个人使用。

## 🤖 开发说明

本项目完全由 **DeepSeek V4 Flash** 模型开发。源码、文档、测试均由 AI 生成,并由人工进行真机验证与评审。

## 📄 License

MIT
