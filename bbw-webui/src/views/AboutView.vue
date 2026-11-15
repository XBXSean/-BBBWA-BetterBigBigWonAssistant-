<script setup>
import { state, setShowTech } from "../core/store.js";

const FIELDS = [
  ["[0..1]", "CRC-16/MODBUS（校验范围 [2..507]）", "已验证"],
  ["[2..3]", "头 01 FC", "已验证"],
  ["[4]", "微动位 bit0 左 / bit1 右", "已验证"],
  ["[5..8]", "扳机行程：下限、100−上限", "已验证"],
  ["[12..13]", "[13] 物理摇杆轴反转", "部分验证"],
  ["[14+48]", "左摇杆槽：+2 死区、+4..13 五个断点", "已验证"],
  ["[62+48]", "右摇杆槽（同构）", "已验证"],
  ["[304]", "体感：高半字节响应方式、低半字节模拟摇杆", "已验证"],
  ["[305..308]", "触发按键位图", "部分验证"],
  ["[311]", "bit1 水平反转、bit2 垂直反转", "已验证"],
  ["[312..318]", "体感四参数", "写入不生效"],
  ["[344..347]", "键位使能位图", "部分验证"],
  ["[352..360]", "震动参数与档位", "语义未验证"],
  ["[380..507]", "键位槽 32 × 4B", "已验证"],
];
</script>

<template>
  <div class="grid split">
    <div class="card">
      <div class="card-head"><div class="grow"><h2>字段</h2><p>508B 数据流，v39 协议。</p></div></div>
      <table class="tbl">
        <thead><tr><th>偏移</th><th>含义</th><th>状态</th></tr></thead>
        <tbody>
          <tr v-for="f in FIELDS" :key="f[0]">
            <td class="mono">{{ f[0] }}</td>
            <td>{{ f[1] }}</td>
            <td>
              <span class="badge" :class="f[2] === '已验证' ? 'ok' : f[2] === '写入不生效' ? 'warn' : ''">{{ f[2] }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="card">
        <div class="card-head"><div class="grow"><h2>显示</h2><p>界面上的字节与公式注解。</p></div></div>
        <div class="field">
          <div class="grow"><div class="label">显示字段注解</div></div>
          <button class="switch" :class="{ on: state.showTech }" @click="setShowTech(!state.showTech)"></button>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="grow"><h2>协议</h2></div></div>
        <div class="hint mono" style="line-height:2">
          通道：MI_02 · usagePage 0xFF7A · 64B 报告<br />
          读：a5 04 d6 7f → 9 × (a4 40 d6 01..09)<br />
          写：9 × (a4 40 d7 01..09)，数据流 508B<br />
          帧校验：sum(frame[0..62]) mod 256<br />
          数据流校验：CRC-16/MODBUS
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="grow"><h2>已验证</h2></div></div>
        <ul class="hint" style="margin:0;padding-left:16px;line-height:1.9">
          <li>扳机换算 9/9 组吻合</li>
          <li>摇杆为径向死区 + 径向曲线，方向守恒</li>
          <li>体感由倾角驱动，输出叠加在左摇杆</li>
          <li>写 [304] 会触发 USB 重枚举</li>
        </ul>
      </div>

      <div class="card">
        <div class="card-head"><div class="grow"><h2>未确认</h2></div></div>
        <ul class="hint" style="margin:0;padding-left:16px;line-height:1.9">
          <li>[9]、[309]、[310]、[12] 高位</li>
          <li>[319..343]、[348]</li>
          <li>[361..376] 存在写入翻转，回写需补偿</li>
          <li>触发按键枚举表仅 A 键确认</li>
        </ul>
      </div>
    </div>
  </div>
</template>
