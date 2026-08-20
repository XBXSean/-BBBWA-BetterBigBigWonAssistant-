// v39 508B 写数据流布局 —— 基于官方配置工具行为的协议分析
// 数据流 = 512B 内部缓冲 [4..511](512B = a4 d7 fc 01 + 数据流)
import { OFF } from "./write-format.js";

/** 应用 profile 偏移(a2) ↔ 设备 508B 数据流偏移(a3) */
export const PROFILE_TO_V39 = [
  // [appProfileOff, dataStreamOff, size, 说明]
  [396, 304, 1, "sensorMode(高4位)"],
  [392, 304, 1, "enumSensorMode(低4位)"],
  [340, 311, 1, "extraFlag(mode2)"],
  [356, 311, 1, "xAxisReversal"],
  [360, 311, 1, "yAxisReversal"],
  [344, 305, 4, "simKeys 位图 dword"],
  [268, 315, 1, "gyroA"],
  [264, 316, 1, "gyroB"],
  [272, 318, 1, "gyroC"],
  [276, 312, 1, "gyroD"],
  [364, 360, 1, "震动档位"],
  [376, 354, 1, "震动参数1"],
  [380, 358, 1, "震动参数2"],
  [384, 355, 1, "震动参数3"],
  [388, 359, 1, "震动参数4"],
  [2568, 5, 1, "左扳机死区下限"],
  [2572, 6, 1, "左扳机死区上限(100补码)"],
  [2580, 7, 1, "右扳机死区下限"],
  [2584, 8, 1, "右扳机死区上限(100补码)"],
  [2576, 4, 1, "左 hire 位"],
  [2588, 4, 1, "右 hire 位"],
  [500, 14, 14, "扳机槽0"],
  [1584, 62, 14, "扳机槽1"],
  [828, 110, 14, "扳机槽2"],
  [1912, 158, 14, "扳机槽3"],
  [1156, 206, 14, "扳机槽4"],
  [2240, 254, 14, "扳机槽5"],
  [2592, 472, 16, "键位/宏条目区(部分)"],
  [2592, 380, 128, "键位槽区 32×4B(由 28B 键条目经 GetKeymapType/ImplantKeymap 编码,非直拷)"],
];

/** 508B 数据流偏移 → 说明(v39) */
export const V39_OFFSETS = {
  [OFF.checksum16]: "校验 CRC-16/MODBUS [0..1]",
  [OFF.header]: "头 01 fc 00",
  [OFF.hireFlags]: "hire 位标志",
  [OFF.triggerDeadzone]: "扳机死区范围 [5..8]",
  [OFF.featFlags]: "功能位 [12..13]",
  [OFF.triggers]: "6 扳机槽 ×48B @14/62/110/158/206/254",
  [OFF.sensorMode]: "传感器模式",
  [OFF.simKeys]: "sim_keys 位图",
  [OFF.axisFlags]: "轴反转/模式位",
  [OFF.gyro]: "陀螺仪参数",
  [OFF.keyEnable]: "键位使能位图 [344..347]",
  [OFF.shock]: "震动参数+档位",
  [OFF.keySlots]: "键位槽区 [380..507] = 32×4B(键类型+编码)",
  [OFF.keySection]: "键位/宏条目区 [472..487](= 键位槽 23..26)",
};

export { OFF };
