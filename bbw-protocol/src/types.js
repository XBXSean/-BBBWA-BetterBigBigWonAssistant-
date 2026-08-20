/**
 * 应用 profile 数据模型(JSDoc 类型定义)
 *
 * 这是上层调参页直接操作的数据模型;encode() 负责转成设备字节。
 */

/**
 * @typedef {Object} TriggerConfig
 * @property {number} mode     模式/曲线类型 (clamp 0..3; 3 → 100)
 * @property {number} [param1] 副参数字节
 * @property {number} c        clamp(0..100) → 槽[2]
 * @property {number} s        clamp(0..100) → 槽[3]
 * @property {number[]} curve  8 点响应曲线 (clamp -128..127)
 * @property {number} [c2]     第二组 c(默认 0 → 槽[12]=100)
 * @property {number} [s2]     第二组 s(默认 0 → 槽[13]=100)
 */

/**
 * @typedef {Object} MotionConfig
 * @property {number} [gyroA]  陀螺仪参数 1 (→ 设备 +114)
 * @property {number} [gyroB]  陀螺仪参数 2 (→ 设备 +111)
 * @property {number} [gyroC]  陀螺仪参数 3 (→ 设备 +112)
 * @property {number} [gyroD]  陀螺仪参数 4 (→ 设备 +108)
 * @property {number} [enumSensorMode] 传感器模式枚举 (0/1/2)
 * @property {number} [sensorMode]     传感器模式 (→ +100 高 4 位)
 * @property {number[]} [simKeys] 体感模拟摇杆键列表 (值 0..20)
 * @property {number} [xAxisReversal] 轴反转 X (0/1)
 * @property {number} [yAxisReversal] 轴反转 Y (0/1)
 * @property {number} [extraFlag]     附加标志 (enumSensorMode==2 时 bit0)
 */

/**
 * @typedef {Object} ShockConfig
 * @property {number} [grade]   震动档位 (→ 设备 +187)
 * @property {number[]} [params] 4 个震动参数
 * @property {boolean} [modelB] true=设备型号 B 布局 (+179..184), false=型号 A (+181..186)
 */

/**
 * @typedef {Object} DeadzoneConfig
 * @property {number} c0  L 中心死区 (→ +5)
 * @property {number} s0  L 灵敏度 (→ +6 = 100-s0)
 * @property {number} c1  R 中心死区 (→ +7)
 * @property {number} s1  R 灵敏度 (→ +8 = 100-s1)
 * @property {number} [hire0] L 使能位 (→ +4 bit0)
 * @property {number} [hire1] R 使能位 (→ +4 bit1)
 */

/**
 * @typedef {Object} KeySlot
 * @property {number} key     键值 (-2 = 未设置)
 * @property {number} [type]  条目类型 (1=键盘 / 2=鼠标 / 3=组合)
 * @property {number} [code1] 键码 1
 * @property {number} [code2] 键码 2 (-1 填充)
 * @property {number} [extra] 扩展字节
 * @property {number} [action] 动作参数 (→ +144 区)
 * @property {number} [enabled] 是否使能 (→ +140 位图)
 */

/**
 * @typedef {Object} MacroConfig
 * @property {number} [count] 宏数量
 * @property {KeySlot[][]} [slots] 4 宏 × 4 键槽
 */

/**
 * @typedef {Object} AppProfile
 * @property {MotionConfig} motion
 * @property {ShockConfig} shock
 * @property {TriggerConfig[]} triggers 6 个扳机
 * @property {DeadzoneConfig} deadzone
 * @property {KeySlot[]} [keys] 32 个键槽
 * @property {MacroConfig} [macro]
 * @property {Uint8Array} [light] 128B 灯效区 (直通)
 */

export {};
