<script setup>
import { computed, onMounted } from "vue";
import Icon from "./components/Icon.vue";
import {
  state, model, dirty, diff, diffItems, ROUTES, go, connect, disconnect, read,
  requestWrite, setAutoWrite, acceptConfirm, closeConfirm,
  cycleTheme, init, toast,
} from "./core/store.js";
import DashboardView from "./views/DashboardView.vue";
import MappingView from "./views/MappingView.vue";
import SticksView from "./views/SticksView.vue";
import TriggersView from "./views/TriggersView.vue";
import MotionView from "./views/MotionView.vue";
import ShockView from "./views/ShockView.vue";
import DebugView from "./views/DebugView.vue";
import BackupView from "./views/BackupView.vue";
import AboutView from "./views/AboutView.vue";

const VIEWS = {
  dashboard: DashboardView, mapping: MappingView, sticks: SticksView, triggers: TriggersView,
  motion: MotionView, shock: ShockView, debug: DebugView, backup: BackupView, about: AboutView,
};

const PAGE_META = {
  dashboard: ["状态", "设备信息与当前配置"],
  mapping: ["按键映射", "物理按键的输出映射"],
  sticks: ["摇杆", "径向死区与 5 点曲线"],
  triggers: ["扳机", "行程范围与微动模式"],
  motion: ["体感", "倾角驱动摇杆"],
  shock: ["震动", "档位与马达参数"],
  debug: ["调试", "508 字节逐字节对照"],
  backup: ["备份", "导出、导入、恢复出厂"],
  about: ["关于", "字段来源与已验证范围"],
};

const groups = computed(() => {
  const out = [];
  for (const r of ROUTES) {
    let g = out.find((x) => x.name === r.group);
    if (!g) out.push((g = { name: r.group, items: [] }));
    g.items.push(r);
  }
  return out;
});

const meta = computed(() => PAGE_META[state.route] ?? PAGE_META.dashboard);
const view = computed(() => VIEWS[state.route] ?? DashboardView);
const gated = computed(() => !state.connected && state.route !== "dashboard" && state.route !== "about");

onMounted(init);
</script>

<template>
  <div class="app">
    <!-- ================= 侧边栏 ================= -->
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-text">
          <b>墨将控制台</b>
          <span>彩虹3 · 508B 直驱</span>
        </div>
      </div>

      <div class="device-card">
        <div class="name">
          <span class="dot" :class="state.connected ? (state.mock ? 'warn' : 'ok') : 'off'"
            :style="state.connected ? '' : ''"></span>
          <span>{{ state.connected ? (state.info?.productName || '已连接') : '未连接设备' }}</span>
        </div>
        <div class="meta">
          {{ state.connected
            ? (state.mock ? '模拟设备 · 写入只落本地' : 'VID 413D / PID 2104')
            : '未连接' }}
        </div>
        <div class="acts">
          <button v-if="!state.connected" class="btn primary" :disabled="state.busy" @click="connect(false)">
            <Icon name="plug" :size="13" />连接设备
          </button>
          <button v-if="!state.connected" class="btn" :disabled="state.busy" @click="connect(true)">
            模拟设备
          </button>
          <template v-else>
            <button class="btn" :disabled="state.busy" @click="read">
              <Icon name="refresh" :size="13" />读取
            </button>
            <button class="btn ghost" @click="disconnect">断开</button>
          </template>
        </div>
      </div>

      <div v-for="g in groups" :key="g.name" class="nav-group">
        <div class="nav-label">{{ g.name }}</div>
        <button v-for="r in g.items" :key="r.id" class="nav-item" :class="{ on: state.route === r.id }"
          @click="go(r.id)">
          <Icon class="nav-ico" :name="r.icon" :size="16" />
          <span class="nav-text">{{ r.label }}</span>
          <span v-if="r.id === 'mapping' && model" class="nav-hint">
            {{ model.keySlots.filter((s) => s.type).length }}
          </span>
          <span v-if="r.id === 'debug' && dirty" class="nav-hint" style="color:rgb(var(--warning))">
            {{ diffItems.length }}
          </span>
        </button>
      </div>

      <div class="sidebar-foot">
        <div class="tiny">
          v2.0 · WebHID 直驱<br />
          <span v-if="state.mock" class="accent">模拟模式：写入只落本地</span>
          <span v-else>协议逆向自 WndMgr / DevMgr</span>
        </div>
      </div>
    </aside>

    <!-- ================= 主区 ================= -->
    <div class="main">
      <header class="topbar">
        <div>
          <h1>{{ meta[0] }}</h1>
          <div class="sub">{{ meta[1] }}</div>
        </div>
        <div class="spacer"></div>

        <span class="badge" :class="state.connected ? (state.mock ? 'warn' : 'ok') : ''">
          <span class="dot" :class="state.connected ? (state.mock ? 'warn' : 'ok') : 'off'"></span>
          {{ state.connected ? (state.mock ? '模拟设备' : '已连接') : '未连接' }}
        </span>
        <span v-if="dirty" class="badge warn" :title="diffItems.map((i) => i.label).join('、')">
          <Icon name="warn" :size="12" />{{ diffItems.length }} 项未写入
        </span>

        <button class="btn sm" :disabled="!state.connected || state.busy" @click="read">
          <Icon name="refresh" :size="13" />读取
        </button>
        <label class="check" :title="state.autoWrite ? '改动后立即写入设备' : '改动后需手动写入'">
          <input type="checkbox" :checked="state.autoWrite" :disabled="!state.connected"
            @change="setAutoWrite($event.target.checked)" />
          <span>自动写入</span>
        </label>
        <button class="btn sm primary" :disabled="!state.connected || !dirty || state.busy || state.autoWrite"
          @click="requestWrite">
          <Icon name="save" :size="13" />写入设备
        </button>
        <button class="btn sm ghost" :title="'主题：' + state.theme" @click="cycleTheme">
          <Icon :name="state.theme === 'dark' ? 'moon' : 'sun'" :size="15" />
        </button>
      </header>

      <main class="content">
        <div class="content-inner page" :key="state.route">
          <template v-if="gated">
            <div class="card glass">
              <div class="empty">
                <Icon name="plug" :size="44" />
                <div class="big">请连接手柄</div>
                <div class="hint">使用 USB 连接手柄后点击按钮。未插手柄时可用模拟设备。</div>
                <div class="row" style="margin-top:10px">
                  <button class="btn primary lg" @click="connect(false)">连接设备</button>
                  <button class="btn lg" @click="connect(true)">模拟设备</button>
                </div>
              </div>
            </div>
          </template>
          <component v-else :is="view" />
        </div>
      </main>
    </div>

    <!-- ================= 写入确认 ================= -->
    <div v-if="state.confirm" class="modal-mask" @click.self="closeConfirm">
      <div class="modal" style="width:min(420px,calc(100vw - 40px))">
        <header>
          <h3>写入设备</h3>
        </header>
        <div class="body">
          <p style="margin:0 0 6px;font-size:15px;line-height:1.6">
            将 {{ state.confirm.count }} 项设置直接写入{{ state.confirm.mock ? '模拟设备' : '手柄' }}。
          </p>
          <p class="hint" style="margin:0;font-size:13px">写入后立即生效，界面不再二次确认。</p>
        </div>
        <footer>
          <button class="btn" style="height:34px;font-size:13px" @click="closeConfirm">取消</button>
          <button class="btn primary" style="height:34px;font-size:13px" @click="acceptConfirm">写入</button>
        </footer>
      </div>
    </div>

    <!-- ================= Toast ================= -->
    <div class="toasts">
      <div v-for="t in state.toasts" :key="t.id" class="toast" :class="t.kind">
        <Icon :name="t.kind === 'ok' ? 'check' : t.kind === 'err' ? 'x' : 'warn'" :size="14" />
        <span>{{ t.text }}</span>
      </div>
    </div>
  </div>
</template>
