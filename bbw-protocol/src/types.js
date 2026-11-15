/**
 * 应用 profile 数据模型(JSDoc 类型定义)
 *
 * 对应逆向出的"应用 profile 结构"(WndMgr-RE-report.md §4.7 总览)。
 * 新 UI 的调参页直接操作此模型;encode() 负责转成设备字节。
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
 * 字段名与默认值来自官方 `config.xml` 的 `<motion .../>`
 * @property {number} [gyroSens]    gyro_sens     → [316]（默认 60）
 * @property {number} [h2vRatio]    h2v_ratio     → [315]（默认 10）
 * @property {number} [respCurve]   resp_curve    → [318]（默认 42）
 * @property {number} [deadzoneComp] deadzone_comp → [312]（默认 0）
 * @property {number} [axisFlags]   轴反转/模式位 → [311]（bit0..4 组合）
 * @property {number} [enumSensorMode] 传感器模式枚举 (0/1/2)
 * @property {number} [sensorMode]     传感器模式 (→ +100 高 4 位)
 * @property {number[]} [simKeys] 体感模拟摇杆键列表 (值 0..20)
 * @property {number[]} [gyro]    原始 7B 只读快照（313/314/317 无主）
 */

/**
 * @typedef {Object} ShockConfig
 * 4 个参数按机型写两套偏移（A: 354/355/358/359，B: 352/353/356/357）
 * @property {"A"|"B"} [layout]   实测或指定布局
 * @property {number} [leftMin]   左下限  → 默认 50
 * @property {number} [rightMin]  右下限  → 默认 50
 * @property {number} [leftMax]   左上限  → 默认 200
 * @property {number} [rightMax]  右上限  → 默认 200
 * @property {number} [grade]     档位 → [360]（来源非 profile，建议沿用原值）
 * @property {number[]} [bytes]   旧接口：9 字节 raw 透传（优先级低于上面字段）
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
 * @property {TriggerConfig[]} triggers 6 个扳机 (L/R/L2/R2/... 顺序见 §4.7)
 * @property {DeadzoneConfig} deadzone
 * @property {KeySlot[]} [keys] 32 个键槽
 * @property {MacroConfig} [macro]
 * @property {Uint8Array} [light] 128B 灯效区 (直通)
 */

export {};
