<script setup lang="ts">
/**
 * 🧪 实验性功能面板（默认折叠，放 identify.vue / chips/new.vue 底部）
 * 开关持久化在 localStorage（composables/useLab.ts），各页面即时生效。
 */
const { flags } = useLab()
</script>

<template>
  <details class="mt-6 rounded-lg border border-special-500/20 bg-special-500/5 p-3">
    <summary class="cursor-pointer select-none text-xs font-medium text-ink-secondary">
      🧪 实验性功能（默认关闭，随时可回退）
    </summary>
    <div class="mt-3 space-y-3">
      <div>
        <UCheckbox
          v-model="flags.esclStream"
          label="扫描仪快扫（eSCL 网络直连 + 低 DPI）"
          size="xs"
        />
        <p class="mt-1 pl-6 text-xs text-ink-tertiary">
          开启后「扫码查详情」的扫描仪按钮改走 eSCL（{{ 'http://192.168.1.208/eSCL' }}，不走 USB）：
          整面扫描、200dpi（静态扫描不糊，自封袋小码实测可解）。
          实测约 6~8 秒（对比原 WIA 整面 5~15 秒）。关闭 = 原行为零变化。
        </p>
      </div>
      <div>
        <UCheckbox
          v-model="flags.hk32Read"
          label="HK32 UID 自动填写（航顺 HK32F030M / SWD 读取）"
          size="xs"
        />
        <p class="mt-1 pl-6 text-xs text-ink-tertiary">
          读取器列表追加「HK32 系列（实验）」通道：UID 64bit @0x1FFFF818、16KB Flash（系列固定）。
          当年 UID"漂移"实为 VCAP 悬空所致——本通道已含双读校验，接线务必 VCAP 接 4.7uF。
          后端脚本/端点/LinkE 模式保险齐备，仅入口受此开关控制。
        </p>
      </div>
      <div>
        <UCheckbox
          v-model="flags.chipPhoto"
          label="芯片原件照片（扫描仪扫实物，一颗一张）"
          size="xs"
        />
        <p class="mt-1 pl-6 text-xs text-ink-tertiary">
          录入页/详情页出现「扫原件」入口：整面 200dpi 彩色扫描 → 自动裁白边 → JPEG 入库
          （data/chip-photos/）。扫描路径跟随上面的扫描仪快扫开关（eSCL 直连 / WIA）。
          非强制：旧库存不回头补，出门在外可回头在详情页补扫。关闭 = 入口完全隐藏。
        </p>
      </div>
    </div>
  </details>
</template>
