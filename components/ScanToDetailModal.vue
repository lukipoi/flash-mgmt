<script setup lang="ts">
/**
 * 扫码查详情（电脑端）
 * 两种方式：电脑摄像头扫码 / 手机扫码后回传电脑
 * 扫码内容为标签原有的 "|" 分隔文本，解析其中的 #id 后跳转详情页
 */
const open = defineModel<boolean>('open', { default: false })
const toast = useToast()
const showScanner = ref(false)
const showPhoneScan = ref(false)
const resolving = ref(false)
const scanningDevice = ref(false)
const { flags: labFlags } = useLab()
const scanBtnLabel = computed(() =>
  labFlags.value.esclStream ? '扫描仪快扫（eSCL 直连，约 6~8 秒）' : '扫描仪扫描（放玻璃上，约 5~15 秒）')

function detailPath(kind: string, id?: number, name?: string): string | null {
  if (kind === 'container' && name) return `/chips?search=${encodeURIComponent(name)}`
  if (id === undefined) return null
  switch (kind) {
    case 'chip': return `/chips/${id}`
    case 'equipment': return `/equipment/${id}`
    case 'consumable': return `/consumables/${id}`
    case 'board': return `/boards/${id}`
    default: return null
  }
}

async function handleScanned(text: string) {
  if (resolving.value || !text?.trim()) return
  resolving.value = true
  try {
    const res = await $fetch<{ kind: string; id?: number; name?: string }>('/api/scan/resolve', {
      method: 'POST',
      body: { text }
    })
    const path = detailPath(res.kind, res.id, res.name)
    if (!path) throw new Error('无法识别的二维码')
    open.value = false
    showScanner.value = false
    showPhoneScan.value = false
    await navigateTo(path)
  } catch (err: any) {
    toast.add({
      title: '扫码失败',
      description: err?.statusMessage || err?.data?.statusMessage || err?.message || '未找到匹配的物品',
      color: 'error'
    })
  } finally {
    resolving.value = false
  }
}
/**
 * 扫描仪扫描（走后端 /api/scanner/scan → Python scan_once.py）
 * 🧪 实验开关「扫描仪快扫」开启时：body 带 escl 地址 + dpi=200 走 eSCL 网络直连
 *   （整面快扫，静态扫描不糊、袋装小码可解，实测约 6~8s；见 composables/useLab.ts）
 * 默认关闭 = 原行为（WIA 整面）零变化。
 * 玻璃上可能同时有多张标签：含 #id 的文本优先，逐条尝试 resolve，第一个命中即跳转
 */
async function handleDeviceScan() {
  if (scanningDevice.value || resolving.value) return
  scanningDevice.value = true
  const { flags } = useLab()
  const body: Record<string, any> = {}
  if (flags.value.esclStream) {
    body.escl = LAB_DEFAULT_ESCL
    body.dpi = LAB_ESCL_DPI
  }
  try {
    const res = await $fetch<{ texts: { text: string; format: string }[]; elapsedMs: number }>(
      '/api/scanner/scan',
      { method: 'POST', body },
    )
    const texts = (res.texts || []).map(t => t.text).filter(Boolean)
    if (!texts.length) throw new Error('扫描完成，但玻璃上没有识别到条码/二维码')
    // 系统标签（二维码文本含 #id）排在外来标签前面
    texts.sort((a, b) => Number(/#\d+/.test(b)) - Number(/#\d+/.test(a)))

    for (const text of texts) {
      try {
        const r = await $fetch<{ kind: string; id?: number; name?: string }>('/api/scan/resolve', {
          method: 'POST',
          body: { text },
        })
        const path = detailPath(r.kind, r.id, r.name)
        if (!path) continue
        open.value = false
        await navigateTo(path)
        return
      } catch {
        // 该文本不是系统内物品，试下一条
      }
    }
    throw new Error('识别到条码，但没有一条是系统内物品')
  } catch (err: any) {
    toast.add({
      title: '扫描仪扫描失败',
      description: err?.statusMessage || err?.data?.statusMessage || err?.message || '未知错误',
      color: 'error',
    })
  } finally {
    scanningDevice.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="扫码查详情">
    <template #body>
      <div class="space-y-3">
        <p class="text-sm text-ink-secondary">扫描标签上的二维码，自动打开对应物品的详情页。</p>
        <UButton
          icon="i-lucide-scan"
          size="lg"
          class="w-full justify-center"
          :loading="scanningDevice"
          :disabled="resolving"
          @click="handleDeviceScan"
        >
          {{ scanBtnLabel }}
        </UButton>
        <UButton
          icon="i-lucide-scan-line"
          size="lg"
          class="w-full justify-center"
          :loading="resolving"
          @click="() => { open = false; showScanner = true }"
        >
          电脑摄像头扫码
        </UButton>
        <UButton
          icon="i-lucide-smartphone"
          size="lg"
          color="neutral"
          variant="outline"
          class="w-full justify-center"
          :loading="resolving"
          @click="() => { open = false; showPhoneScan = true }"
        >
          手机扫码并回传
        </UButton>
      </div>
    </template>
  </UModal>

  <BarcodeScannerModal v-model:open="showScanner" @scanned="handleScanned" />
  <PhoneScanModal v-model:open="showPhoneScan" @scanned="handleScanned" />
</template>
