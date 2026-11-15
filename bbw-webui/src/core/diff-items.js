/**
 * 把「字节差异」折叠成「设置项」。
 *
 * 改一个下拉框往往牵动多个字节（键位槽 4B + 使能位 + CRC 2B），按字节报数会让人以为改了很多东西。
 * 这里按已核实的字段区间归组：CRC 视为派生值不计，使能位按 bit 归到对应键位项。
 */
import { keyName, slotToCode } from "../lib/names.js";

const RANGES = [
  { key: "hire", label: "微动模式", a: 4, b: 4 },
  { key: "trigL", label: "左扳机行程", a: 5, b: 6 },
  { key: "trigR", label: "右扳机行程", a: 7, b: 8 },
  { key: "invert", label: "摇杆轴反转", a: 12, b: 13 },
  { key: "stickL", label: "左摇杆曲线", a: 14, b: 61 },
  { key: "stickR", label: "右摇杆曲线", a: 62, b: 109 },
  { key: "motion", label: "体感", a: 304, b: 311 },
  { key: "shock", label: "震动", a: 352, b: 360 },
];

const slotLabel = (i) => {
  const code = slotToCode(i);
  return "键位 " + (code >= 0 ? keyName(code) : `#${i + 1}`);
};

/**
 * @param {{off:number, from:number, to:number}[]} diff
 * @returns {{key:string, label:string, bytes:number[]}[]}
 */
export function groupDiff(diff) {
  const map = new Map();

  const push = (key, label, off, byEnable) => {
    const cur = map.get(key) ?? { key, label, bytes: [], onlyEnable: true };
    cur.bytes.push(off);
    if (!byEnable) cur.onlyEnable = false;
    map.set(key, cur);
  };

  for (const d of diff) {
    const off = d.off;
    if (off <= 1) continue; // CRC-16，写之前才重算

    // 键位使能位图：按发生变化的 bit 归到对应键位，和槽字节合成一项
    if (off >= 344 && off <= 347) {
      const chg = (d.from ^ d.to) & 0xff;
      const base = (off - 344) * 8;
      for (let bit = 0; bit < 8; bit++) {
        if (!(chg & (1 << bit))) continue;
        const i = base + bit;
        push("slot" + i, slotLabel(i), off, true);
      }
      continue;
    }

    if (off >= 380 && off <= 507) {
      const i = Math.floor((off - 380) / 4);
      push("slot" + i, slotLabel(i), off, false);
      continue;
    }

    const g = RANGES.find((r) => off >= r.a && off <= r.b);
    push(g ? g.key : "byte" + off, g ? g.label : `字节 [${off}]`, off, false);
  }

  return [...map.values()].map((it) => ({
    key: it.key,
    label: it.onlyEnable ? it.label + "（使能）" : it.label,
    bytes: it.bytes,
  }));
}
