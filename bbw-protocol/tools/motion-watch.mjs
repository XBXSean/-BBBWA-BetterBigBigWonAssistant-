#!/usr/bin/env node
/**
 * 实时观察工具：连续打印 XInput 各轴读数，用于「人转动手柄 → 看哪根轴在动」。
 *
 * 体感是角速度型：静止时输出 0，必须动态输入。这个工具不做统计，只做时间序列，
 * 方便判断响应方向、延迟、是否饱和。
 *
 * 用法：
 *   node tools/motion-watch.mjs --seconds 20 --interval 250
 *   node tools/motion-watch.mjs --seconds 20 --tag yaw        # 输出带标签，便于对照
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const SECONDS = Number(arg("seconds", "20"));
const INTERVAL = Number(arg("interval", "250"));
const TAG = arg("tag", "");

function sample(ms) {
  const r = spawnSync("python", [join(HERE, "xinput-sample.py"), "--ms", String(ms)], {
    encoding: "utf8",
    cwd: join(HERE, ".."),
  });
  const line = (r.stdout || "").trim().split("\n").filter(Boolean).pop() || "{}";
  try {
    return JSON.parse(line);
  } catch {
    return {};
  }
}

const t0 = Date.now();
const keys = ["lx", "ly", "rx", "ry"];
const ext = Object.fromEntries(keys.map((k) => [k, [Infinity, -Infinity]]));
console.log(`时间      LX       LY       RX       RY   ${TAG ? " " + TAG : ""}`);
while (Date.now() - t0 < SECONDS * 1000) {
  const d = sample(INTERVAL);
  if (d.error || d.samples === undefined) {
    console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s  读取失败`);
    continue;
  }
  const v = { lx: d.lx.med, ly: d.ly.med, rx: d.rx.med, ry: d.ry.med };
  for (const k of keys) {
    ext[k][0] = Math.min(ext[k][0], v[k]);
    ext[k][1] = Math.max(ext[k][1], v[k]);
  }
  const p = (x) => String(x).padStart(7);
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${p(v.lx)}  ${p(v.ly)}  ${p(v.rx)}  ${p(v.ry)}`);
}
console.log("--- 区间极值 ---");
for (const k of keys) {
  const [lo, hi] = ext[k];
  console.log(`${k.toUpperCase()}: ${lo} .. ${hi}   幅度 ${hi - lo}`);
}
