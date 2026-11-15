import { test } from "node:test";
import assert from "node:assert/strict";
import { applyJoystickCurve, evalCurvePoints, STICK_FULL_SCALE } from "../src/index.js";

/**
 * 依据真机实测（508B-FIELD-MAP-v39.md §12）固定摇杆径向响应语义。
 * 测量时手柄被固定在 LX=-24563, LY=+10808（径向 81.9%），方向比 -2.27。
 */
const LX = -24563;
const LY = 10808;
const R = Math.hypot(LX, LY);
const RADIUS = (R / STICK_FULL_SCALE) * 100; // ≈ 81.9

const X_IN = [20, 40, 60, 80, 100];
const slot = (outs, dz = 0, ins = X_IN) => ({
  deadzoneCenter: dz,
  points: ins.map((x, i) => ({ in: x, out: outs[i] })),
});
const mag = (r) => Math.hypot(r.x, r.y);

test("径向：曲线输出 100 时输出模长等于满量程", () => {
  const r = applyJoystickCurve(slot([0, 0, 100, 100, 100]), LX, LY);
  assert.ok(Math.abs(mag(r) - STICK_FULL_SCALE) < 1, `模长 ${mag(r)} 应≈32767`);
});

test("径向：曲线输出全 0 时整根向量归零（不是只归零一个轴）", () => {
  const r = applyJoystickCurve(slot([100, 100, 0, 0, 0]), LX, LY);
  assert.ok(r.x === 0 && r.y === 0, `应精确归零，实际 ${r.x}/${r.y}`); // -0 与 0 同义，不用 strictEqual
  assert.equal(r.clamped, false);
});

test("径向：查表只缩放模长，方向严格不变", () => {
  const ratioIn = LY / LX;
  for (const outs of [[0, 0, 100, 100, 100], [0, 0, 0, 100, 0], [0, 0, 0, 0, 100], [50, 50, 50, 50, 50]]) {
    const r = applyJoystickCurve(slot(outs), LX, LY);
    assert.ok(Math.abs(r.y / r.x - ratioIn) < 1e-9, `曲线 ${outs} 方向比变了`);
  }
});

test("径向：平坦曲线输出即占满量程的百分比（与输入位置无关）", () => {
  for (const y of [0, 25, 50, 75, 100]) {
    const r = applyJoystickCurve(slot([y, y, y, y, y]), LX, LY);
    assert.ok(Math.abs(r.out - y) < 1e-9);
    assert.ok(Math.abs(mag(r) - (y / 100) * STICK_FULL_SCALE) < 1);
  }
});

test("径向死区：r <= deadzoneCenter 时整根向量归零", () => {
  const dz = Math.floor(RADIUS) + 1;
  const r = applyJoystickCurve(slot([20, 40, 60, 80, 100], dz), LX, LY);
  assert.equal(r.clamped, true);
  assert.equal(r.x, 0);
  assert.equal(r.y, 0);
});

test("径向死区：(r-dz)/(100-dz) 重映射，实测 7 档均已验", () => {
  // 真机数据（默认曲线 24/43/62/81/100）：dz=0/20/40/60/70 时输出模长占满量程 82.2/77.7/70.2/55.3/40.4%
  // 模型存在系统性 ~1% 高估：固件实际用的径向约 81.2%，而 hypot/32767 = 81.9%
  // （推测原始 HID 轴与 XInput 输出存在微小比例差），故容差取 2.5 个百分点。
  const measured = [[0, 82.2], [20, 77.7], [40, 70.2], [60, 55.3], [70, 40.4]];
  for (const [dz, expect] of measured) {
    const r = applyJoystickCurve(slot([24, 43, 62, 81, 100], dz), LX, LY);
    const pct = (mag(r) / STICK_FULL_SCALE) * 100;
    assert.ok(Math.abs(pct - expect) < 2.5, `dz=${dz} 实测 ${expect}%，模型 ${pct.toFixed(1)}%`);
  }
});

test("低于首个断点：从原点线性插值（实测 45.0%，非钳位到首点输出）", () => {
  // 真机：x=90,92,94,96,100 / y=50,50,50,50,100，r=81.9 → 实测 45.0% 满量程
  const ins = [90, 92, 94, 96, 100];
  const r = applyJoystickCurve(slot([50, 50, 50, 50, 100], 0, ins), LX, LY);
  const pct = (mag(r) / STICK_FULL_SCALE) * 100;
  assert.ok(Math.abs(pct - 45.0) < 1.5, `实测 45.0%，模型 ${pct.toFixed(1)}%（若钳位则应为 50%）`);
  assert.ok(pct < 48, "不应钳位到首点输出 50%");
});

test("evalCurvePoints：端点钳位与斜率", () => {
  const pts = [{ in: 20, out: 24 }, { in: 40, out: 43 }, { in: 60, out: 62 }, { in: 80, out: 81 }, { in: 100, out: 100 }];
  assert.equal(evalCurvePoints(pts, 0), 0);
  assert.equal(evalCurvePoints(pts, 20), 24);
  assert.ok(Math.abs(evalCurvePoints(pts, 50) - 52.5) < 1e-9);
  assert.equal(evalCurvePoints(pts, 100), 100);
  assert.equal(evalCurvePoints(pts, 150), 100); // 超末点钳位
  assert.ok(Math.abs(evalCurvePoints(pts, 10) - 12) < 1e-9); // (0,0)→(20,24)
});

test("形状与真机一致：默认槽 0 曲线在 81.9% 处输出约 82.8%", () => {
  const r = applyJoystickCurve(slot([24, 43, 62, 81, 100]), LX, LY);
  assert.ok(Math.abs(r.out - 82.8) < 0.3, `out=${r.out}`);
  // 基线实测模长 26838，模型 27135，误差 <1.2%
  assert.ok(Math.abs((mag(r) / 26838 - 1) * 100) < 1.5);
});
