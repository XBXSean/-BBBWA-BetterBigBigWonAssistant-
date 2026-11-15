<script setup>
import { computed } from "vue";
import { model, edit } from "../core/store.js";

const s = computed(() => model.value.shock);
function setGrade(v) { edit({ shock: { grade: Number(v) } }); }
function setParam(i, v) {
  const params = [...s.value.params];
  params[i] = Math.max(0, Math.min(255, Number(v)));
  edit({ shock: { params } });
}
const LABELS = ["左下限", "左上限", "右下限", "右上限", "参数 5", "参数 6", "参数 7", "参数 8"];
</script>

<template>
  <div class="grid split">
    <div class="card">
      <div class="card-head">
        <div class="grow">
          <h2>震动参数</h2>
          <p>[352..359] 八个字节与 [360] 档位。本页只写参数，不会触发马达。</p>
        </div>
        <span class="badge warn">语义未验证</span>
      </div>

      <div class="field">
        <div class="grow">
          <div class="label">档位</div>
          <div class="desc">[360]，官方软件的强度档位</div>
        </div>
        <input class="input num" type="number" min="0" max="255" :value="s.grade"
          @change="setGrade($event.target.value)" />
      </div>

      <div class="grid c4" style="gap:10px;margin-top:12px">
        <div v-for="(v, i) in s.params" :key="i">
          <div class="hint" style="margin-bottom:4px">{{ LABELS[i] }}</div>
          <input class="input mono" style="width:100%" type="number" min="0" max="255" :value="v"
            @change="setParam(i, $event.target.value)" />
          <div class="hint mono tech" style="margin-top:2px">[{{ 352 + i }}]</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="grow"><h2>说明</h2></div></div>
      <ul class="hint" style="margin:0;padding-left:16px;line-height:1.9">
        <li>这 8 个字节的含义只确认到「左/右 × 下限/上限」的前四字节，其余四个无真机结论</li>
        <li>官方存在 A / B 两套布局，按机型判定，跨机型写错会出现马达常转或无声</li>
        <li>本工具的任何写入路径都不会下发震动命令，[352..360] 之外的震动指令区已从代码中移除</li>
        <li>不确定时优先用「备份」页导出原值，再改这里</li>
      </ul>
      <div class="hint mono tech" style="margin-top:12px">
        {{ s.params.map((v, i) => `[${352 + i}]=${v}`).join(' ') }} [360]={{ s.grade }}
      </div>
    </div>
  </div>
</template>
