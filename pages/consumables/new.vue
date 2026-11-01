<script setup lang="ts">
import type { Consumable, ConsumableStatus } from '~~/shared/types'

definePageMeta({
  title: '录入耗材'
})

const STATUS_OPTIONS = [
  { label: '储备中', value: 'in_stock' },
  { label: '使用中', value: 'in_use' }
]

const form = reactive({
  brand: '',
  model: '',
  serial_number: '',
  barcode: '',
  location_a: '',
  location_b: '',
  location_c: '',
  status: 'in_stock' as ConsumableStatus,
  shelf_life: '',
  production_date: '',
  expiry_date: '',
  batch_number: '',
  exec_standard: '',
  net_content: '',
  note: '',
  quantity: 1
})

// 库位：大箱 + 小箱填齐后，序号自动取同组最大 + 1
let fetchSeqPromise: Promise<void> | null = null
async function tryAutoSeq() {
  if (!form.location_a?.trim() || !form.location_b?.trim() || form.location_c?.trim()) return
  if (fetchSeqPromise) return
  fetchSeqPromise = (async () => {
    try {
      const rows: any[] = await $fetch('/api/consumables', {
        params: { location_a: form.location_a.trim(), location_b: form.location_b.trim() }
      })
      let maxN = 0
      for (const r of rows) {
        const n = parseInt(r.location_c, 10)
        if (!isNaN(n) && n > maxN) maxN = n
      }
      if (!form.location_c?.trim()) form.location_c = String(maxN + 1)
    } catch { /* 忽略 */ }
    fetchSeqPromise = null
  })()
}
watch(() => [form.location_a, form.location_b] as const, () => tryAutoSeq())

const submitting = ref(false)
const submitError = ref<string | null>(null)
const showScanner = ref(false)
const showPhoneScan = ref(false)

const errors = computed(() => {
  const e: Record<string, string> = {}
  if (!form.model.trim()) e.model = '型号为必填项'
  return e
})

const isValid = computed(() => Object.keys(errors.value).length === 0)

async function submit() {
  if (!isValid.value) return
  submitting.value = true
  submitError.value = null
  try {
    const result = await $fetch<Consumable>('/api/consumables', {
      method: 'POST',
      body: {
        brand: form.brand.trim() || null,
        model: form.model.trim(),
        serial_number: form.serial_number.trim() || null,
        barcode: form.barcode.trim() || null,
        location_a: form.location_a.trim() || null,
        location_b: form.location_b.trim() || null,
        location_c: form.location_c.trim() || null,
        status: form.status,
        shelf_life: form.shelf_life.trim() || null,
        production_date: form.production_date.trim() || null,
        expiry_date: form.expiry_date.trim() || null,
        batch_number: form.batch_number.trim() || null,
        exec_standard: form.exec_standard.trim() || null,
        net_content: form.net_content.trim() || null,
        note: form.note.trim() || null,
        quantity: form.quantity
      }
    })
    navigateTo(`/consumables`)
  } catch (e: any) {
    submitError.value = e.data?.message || e.message || '提交失败'
  } finally {
    submitting.value = false
  }
}

function resetForm() {
  form.brand = ''
  form.model = ''
  form.serial_number = ''
  form.barcode = ''
  form.location_a = ''
  form.location_b = ''
  form.location_c = ''
  form.status = 'in_stock'
  form.shelf_life = ''
  form.production_date = ''
  form.expiry_date = ''
  form.batch_number = ''
  form.exec_standard = ''
  form.net_content = ''
  form.note = ''
  form.quantity = 1
  submitError.value = null
}
</script>

<template>
  <div class="min-h-full p-6">
    <!-- 页头 -->
    <div class="mb-6 flex items-center gap-3">
      <UButton
        to="/consumables"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        size="sm"
      />
      <div>
        <h2 class="text-xl font-bold text-ink">录入耗材</h2>
        <p class="mt-1 text-sm text-ink-tertiary">耗材库存登记</p>
      </div>
    </div>

    <!-- 表单 -->
    <div class="max-w-2xl rounded-lg bg-surface-raised p-6 ring-1 ring-line">
      <div class="space-y-5">
        <!-- 品牌 + 型号 -->
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">品牌</label>
            <UInput
              v-model="form.brand"
              placeholder="如: 3M / 得力 / 安捷伦"
              class="w-full"
            />
          </div>
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">
              型号 <span class="text-alert-400">*</span>
            </label>
            <UInput
              v-model="form.model"
              placeholder="如: 9768 双面胶 / 0.5mm 焊锡丝"
              class="w-full"
              :class="{ 'ring-1 ring-alert-500/50': errors.model }"
            />
            <p v-if="errors.model" class="mt-1 text-xs text-alert-400">{{ errors.model }}</p>
          </div>
        </div>

        <!-- 序列号 + 商品条码 -->
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">序列号</label>
            <UInput
              v-model="form.serial_number"
              placeholder="可留空"
              class="w-full font-mono"
            />
          </div>
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">商品条码</label>
            <div class="flex gap-2">
              <UInput
                v-model="form.barcode"
                placeholder="EAN-13 / UPC / CODE128 等"
                class="w-full font-mono"
              />
              <UButton
                icon="i-lucide-scan-line"
                color="neutral"
                variant="outline"
                title="摄像头扫码"
                @click="() => { showScanner = true }"
              />
              <UButton
                icon="i-lucide-smartphone"
                color="neutral"
                variant="outline"
                title="手机扫码回传"
                @click="() => { showPhoneScan = true }"
              />
            </div>
          </div>
        </div>

        <!-- 生产日期 / 失效日期 -->
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">生产日期</label>
            <UInput
              v-model="form.production_date"
              type="date"
              class="w-full font-mono"
            />
          </div>
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">失效日期</label>
            <UInput
              v-model="form.expiry_date"
              type="date"
              class="w-full font-mono"
            />
            <p class="mt-1 text-xs text-ink-tertiary">填了失效日期则保质期仅作备注</p>
          </div>
        </div>

        <!-- 保质期 / 批号 -->
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">保质期</label>
            <UInput
              v-model="form.shelf_life"
              placeholder="如: 24个月 / 2027-06"
              class="w-full"
            />
          </div>
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">批号</label>
            <UInput
              v-model="form.batch_number"
              placeholder="医药/化工产品批号，可留空"
              class="w-full font-mono"
            />
          </div>
        </div>

        <!-- 执行标准 / 净含量 -->
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">执行标准</label>
            <UInput
              v-model="form.exec_standard"
              placeholder="如: GB/T 2423.1"
              class="w-full"
            />
          </div>
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">净含量</label>
            <UInput
              v-model="form.net_content"
              placeholder="如: 100g / 500ml"
              class="w-full"
            />
          </div>
        </div>

        <!-- 状态 + 数量 -->
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">状态</label>
            <USelect
              v-model="form.status"
              :items="STATUS_OPTIONS"
              class="w-full"
            />
          </div>
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">数量</label>
            <UInput
              v-model.number="form.quantity"
              type="number"
              min="1"
              max="200"
              class="w-full"
            />
            <p v-if="form.quantity > 1" class="mt-1 text-xs text-action">
              批量录入 {{ form.quantity }} 件，库位序号自动递增
            </p>
          </div>
        </div>

        <!-- 库位（三级） -->
        <div>
          <label class="mb-1.5 block text-sm font-medium text-ink-secondary">库位</label>
          <div class="grid grid-cols-3 gap-2">
            <UInput
              v-model="form.location_a"
              placeholder="大箱"
              class="w-full"
            />
            <UInput
              v-model="form.location_b"
              placeholder="小箱"
              class="w-full"
            />
            <UInput
              v-model="form.location_c"
              placeholder="序号"
              class="w-full"
            />
          </div>
          <p class="mt-1 text-xs text-ink-tertiary">可选，三级容器定位：大箱 / 小箱 / 序号</p>
        </div>

        <!-- 备注 -->
        <div>
          <label class="mb-1.5 block text-sm font-medium text-ink-secondary">备注</label>
          <UTextarea
            v-model="form.note"
            placeholder="可选备注信息..."
            class="w-full"
            :rows="3"
          />
        </div>

        <!-- 提交错误 -->
        <div
          v-if="submitError"
          class="flex items-center gap-2 rounded-md bg-alert-500/10 p-3 ring-1 ring-alert-500/20"
        >
          <UIcon name="i-lucide-alert-circle" class="h-5 w-5 shrink-0 text-alert-400" />
          <span class="text-sm text-alert-300">{{ submitError }}</span>
        </div>

        <!-- 操作按钮 -->
        <div class="flex items-center justify-end gap-3 pt-2">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            @click="resetForm"
          >
            重置
          </UButton>
          <UButton
            color="primary"
            variant="solid"
            size="sm"
            icon="i-lucide-check"
            :loading="submitting"
            :disabled="!isValid || submitting"
            @click="submit"
          >
            提交录入
          </UButton>
        </div>
      </div>
    </div>

    <!-- 条码扫描弹窗 -->
    <BarcodeScannerModal v-model:open="showScanner" @scanned="(v: string) => (form.barcode = v)" />

    <!-- 手机扫码回传弹窗 -->
    <PhoneScanModal v-model:open="showPhoneScan" @scanned="(v: string) => (form.barcode = v)" />
  </div>
</template>
