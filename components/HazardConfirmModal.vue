<script setup lang="ts">
/**
 * 危险操作确认弹窗 —— 警戒框语言直接接管整个弹窗（不再「框内框」）
 *
 * 视觉：红边直角面板 + 顶部滚动警示条 + 两行标题 + 原有 footer 按钮。
 * 样式复用 assets/css/endfield/utilities.css 的 .ef-hazard-* 母题类，
 * 颜色全部取自 theme.css 语义令牌，无硬编码色值。
 *
 * 入场 F1（390ms）：点 → 横线 → 上下展开成窗。
 * 退场（400ms）：窗 → 收成线 → 线缩回点 → 遮罩淡出，与入场对称。
 *
 * 关键：父组件可能直接把 v-model 置 false（「取消」按钮、读取成功后关闭），
 * 所以这里用独立的 rendered ref 兜住卸载时机 —— 不论哪条关闭路径，
 * 都先走完逆向收回再真正移除 DOM。
 *
 * 无障碍：role="alertdialog" / ESC 关闭 / 遮罩点击关闭 / body 滚动锁 /
 *         prefers-reduced-motion 下入场退场都直接切换，不做形状生长。
 */
const open = defineModel<boolean>('open', { default: false })

withDefaults(defineProps<{
  title: string
  dangerText?: string
  code?: string
  dismissible?: boolean
}>(), {
  dangerText: '危险操作 · 不可撤销',
  code: 'DANGER / IRREVERSIBLE',
  dismissible: true
})

const CLOSE_MS = 400
const rendered = ref(false)
const closing = ref(false)
let closeTimer: ReturnType<typeof setTimeout> | null = null

function lockScroll(v: boolean) {
  if (typeof document !== 'undefined') document.body.style.overflow = v ? 'hidden' : ''
}
function prefersReducedMotion() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

watch(open, (v) => {
  if (v) {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
    closing.value = false
    rendered.value = true
    lockScroll(true)
  } else if (rendered.value) {
    // 逆向收回：先播退场动画，结束再卸载并解锁滚动
    closing.value = true
    const wait = prefersReducedMotion() ? 0 : CLOSE_MS
    closeTimer = setTimeout(() => {
      rendered.value = false
      closing.value = false
      lockScroll(false)
      closeTimer = null
    }, wait)
  }
}, { immediate: true })

function close() {
  open.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) close()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (closeTimer) clearTimeout(closeTimer)
  lockScroll(false)
})
</script>

<template>
  <ClientOnly>
    <Teleport to="body">
      <div
        v-if="rendered"
        class="ef-hazard-overlay"
        :class="{ 'is-closing': closing }"
        @click.self="close"
      >
        <!-- 入场：点 → 横线；退场：线 → 点 -->
        <div class="ef-hazard-grow" aria-hidden="true" />
        <div
          class="ef-hazard-modal"
          role="alertdialog"
          aria-modal="true"
          :aria-label="title"
        >
          <div class="ef-hazard-strip" aria-hidden="true" />

          <div class="ef-hazard-modal-head">
            <div class="ef-hazard-modal-title">{{ title }}</div>
            <div class="ef-hazard-modal-danger">
              {{ dangerText }}
              <span v-if="code" class="ef-hazard-modal-code">{{ code }}</span>
            </div>
            <button
              v-if="dismissible"
              type="button"
              class="ef-hazard-modal-close"
              aria-label="关闭"
              @click="close"
            >
              <UIcon name="i-lucide-x" class="h-4 w-4" />
            </button>
          </div>

          <div class="ef-hazard-modal-body">
            <slot />
          </div>

          <div v-if="$slots.footer" class="ef-hazard-modal-foot">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Teleport>
  </ClientOnly>
</template>
