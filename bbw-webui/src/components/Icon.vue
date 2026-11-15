<script setup>
const props = defineProps({ name: { type: String, default: "info" }, size: { type: [Number, String], default: 16 } });

// 统一 24×24 视框、1.7 描边、圆角端点，风格对齐参考站
const PATHS = {
  gauge: "M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0-2 5-5M4 18a9 9 0 1 1 16 0",
  keys: "M4 7h16v10H4zM8 11h.01M12 11h.01M16 11h.01M8 14h8",
  stick: "M12 3v3M12 3a2 2 0 1 0 0 .01M6 21v-6a6 6 0 0 1 12 0v6M9 21h6",
  trigger: "M7 20V9a5 5 0 0 1 10 0v11M7 16h10",
  motion: "M12 3v6M12 9l4 4M12 9l-4 4M5 20a7 7 0 0 1 14 0",
  vibe: "M3 10v4M7 7v10M11 4v16M15 7v10M19 10v4",
  code: "M9 7l-4 5 4 5M15 7l4 5-4 5",
  archive: "M4 8h16v11H4zM3 4h18v4H3zM9 12h6",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13h.01M11 12h1v5h1",
  sun: "M12 4V2M12 22v-2M4 12H2M22 12h-2M6 6 4.5 4.5M19.5 19.5 18 18M18 6l1.5-1.5M4.5 19.5 6 18M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  moon: "M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z",
  plug: "M9 3v6M15 3v6M7 9h10v3a5 5 0 0 1-10 0zM12 17v4",
  save: "M4 4h12l4 4v12H4zM8 4v6h8",
  refresh: "M4 12a8 8 0 0 1 13.6-5.7L20 8M20 4v4h-4M20 12a8 8 0 0 1-13.6 5.7L4 16M4 20v-4h4",
  download: "M12 4v11M8 12l4 4 4-4M4 20h16",
  upload: "M12 20V9M8 12l4-4 4 4M4 4h16",
  x: "M6 6l12 12M18 6L6 18",
  check: "M5 13l4 4L19 7",
  warn: "M12 4l9 16H3zM12 10v4M12 17h.01",
  gamepad: "M7 10h4M9 8v4M15 9h.01M17 11h.01M6 7h12a4 4 0 0 1 4 4v3a3 3 0 0 1-5 1.7L15 14H9l-2 1.7A3 3 0 0 1 2 14v-3a4 4 0 0 1 4-4Z",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
  copy: "M8 8h11v12H8zM5 16V4h11",
};
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="PATHS[name] || PATHS.info" />
  </svg>
</template>
