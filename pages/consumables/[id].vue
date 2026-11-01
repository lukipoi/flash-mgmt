<script setup lang="ts">
import type { Consumable, ConsumableStatus } from '~~/shared/types'

const route = useRoute()
const consumableId = route.params.id as string

const { data: consumable, pending, error, refresh } = await useFetch<Consumable>(`/api/consumables/${consumableId}`)

const STATUS_LABELS: Record<ConsumableStatus, string> = {
  in_use: '使用中',
  in_stock: '储备中'
}

const STATUS_STYLES: Record<ConsumableStatus, string> = {
  in_use: 'bg-notice-500/15 text-notice-400 ring-1 ring-notice-500/30',
  in_stock: 'bg-data-500/15 text-action ring-1 ring-action/30'
}

const copied = ref(false)

async function copySn() {
  if (!consumable.value?.serial_number) return
  try {
    await navigator.clipboard.writeText(consumable.value.serial_number)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch { /* ignore */ }
}

// ---- 改备注 ----
const showNoteModal = ref(false)
const noteText = ref('')
const savingNote = ref(false)
const noteError = ref<string | null>(null)

// ---- 编辑附加信息 ----
const showExtraModal = ref(false)
const savingExtra = ref(false)
const extraError = ref<string | null>(null)
const extraForm = reactive({
  shelf_life: '',
  production_date: '',
  expiry_date: '',
  batch_number: '',
  exec_standard: '',
  net_content: ''
})

function openExtraModal() {
  if (!consumable.value) return
  extraForm.shelf_life = consumable.value.shelf_life || ''
  extraForm.production_date = consumable.value.production_date || ''
  extraForm.expiry_date = consumable.value.expiry_date || ''
  extraForm.batch_number = consumable.value.batch_number || ''
  extraForm.exec_standard = consumable.value.exec_standard || ''
  extraForm.net_content = consumable.value.net_content || ''
  extraError.value = null
  showExtraModal.value = true
}

async function saveExtra() {
  if (!consumable.value) return
  savingExtra.value = true
  extraError.value = null
  try {
    await $fetch(`/api/consumables/${consumable.value.id}`, {
      method: 'PUT',
      body: {
        shelf_life: extraForm.shelf_life.trim() || null,
        production_date: extraForm.production_date.trim() || null,
        expiry_date: extraForm.expiry_date.trim() || null,
        batch_number: extraForm.batch_number.trim() || null,
        exec_standard: extraForm.exec_standard.trim() || null,
        net_content: extraForm.net_content.trim() || null
      }
    })
    showExtraModal.value = false
    await refresh()
  } catch (err: any) {
    extraError.value = err?.statusMessage || err?.message || '保存失败'
  } finally {
    savingExtra.value = false
  }
}

async function saveNote() {
  if (!consumable.value) return
  savingNote.value = true
  noteError.value = null
  try {
    await $fetch(`/api/consumables/${consumable.value.id}`, {
      method: 'PUT',
      body: { note: noteText.value.trim() }
    })
    showNoteModal.value = false
    await refresh()
  } catch (err: any) {
    noteError.value = err?.statusMessage || err?.message || '保存失败'
  } finally {
    savingNote.value = false
  }
}

// ---- 改状态 ----
const showStatusModal = ref(false)
const newStatus = ref<ConsumableStatus>('in_stock')
const savingStatus = ref(false)
const statusError = ref<string | null>(null)

function openStatusModal() {
  if (!consumable.value) return
  newStatus.value = consumable.value.status
  statusError.value = null
  showStatusModal.value = true
}

async function saveStatus() {
  if (!consumable.value) return
  savingStatus.value = true
  statusError.value = null
  try {
    await $fetch(`/api/consumables/${consumable.value.id}`, {
      method: 'PUT',
      body: { status: newStatus.value }
    })
    showStatusModal.value = false
    await refresh()
  } catch (err: any) {
    statusError.value = err?.statusMessage || err?.message || '保存失败'
  } finally {
    savingStatus.value = false
  }
}

// ---- 删除 ----
const showDeleteModal = ref(false)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

async function confirmDelete() {
  if (!consumable.value) return
  deleting.value = true
  deleteError.value = null
  try {
    await $fetch(`/api/consumables/${consumable.value.id}`, { method: 'DELETE' })
    showDeleteModal.value = false
    await navigateTo('/consumables')
  } catch (err: any) {
    deleteError.value = err?.statusMessage || err?.message || '删除失败'
  } finally {
    deleting.value = false
  }
}

// ---- 打印标签 ----
const showPrintModal = ref(false)

// ---- 过期日期（生产日期 + 保质期推算） ----
const expiryDate = computed(() =>
  consumable.value ? calcExpiryDate(consumable.value.production_date, consumable.value.shelf_life, consumable.value.expiry_date) : null
)
const expiryWarn = computed(() => expiryWarning(expiryDate.value))
</script>

<template>
  <div class="min-h-full p-6">
    <!-- 页头 -->
    <div class="mb-6 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <UButton
          to="/consumables"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          size="sm"
        />
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-xl font-bold text-ink">
              {{ consumable?.model || '耗材详情' }}
            </h2>
            <UBadge
              v-if="consumable?.brand"
              color="data"
              variant="subtle"
              size="xs"
            >
              {{ consumable.brand }}
            </UBadge>
            <span
              v-if="consumable"
              :class="[STATUS_STYLES[consumable.status], 'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium']"
            >
              {{ STATUS_LABELS[consumable.status] }}
            </span>
          </div>
          <p v-if="consumable" class="mt-1 font-mono text-xs text-ink-tertiary">
            ID: {{ consumable.id }}
          </p>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton
          v-if="consumable"
          icon="i-lucide-pen-line"
          color="neutral"
          variant="outline"
          size="sm"
          @click="noteText = consumable.note || ''; showNoteModal = true"
        >
          改备注
        </UButton>
        <UButton
          v-if="consumable"
          icon="i-lucide-pen-line"
          color="neutral"
          variant="outline"
          size="sm"
          @click="openExtraModal"
        >
          编辑附加信息
        </UButton>
        <UButton
          v-if="consumable"
          icon="i-lucide-activity"
          color="notice"
          variant="outline"
          size="sm"
          @click="openStatusModal"
        >
          改状态
        </UButton>
        <UButton
          v-if="consumable"
          icon="i-lucide-printer"
          color="notice"
          variant="solid"
          size="sm"
          @click="showPrintModal = true"
        >
          打印标签
        </UButton>
        <UButton
          v-if="consumable"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          size="sm"
          :loading="pending"
          @click="refresh()"
        >
          刷新
        </UButton>
        <UButton
          v-if="consumable"
          icon="i-lucide-trash-2"
          color="error"
          variant="outline"
          size="sm"
          @click="showDeleteModal = true"
        >
          删除
        </UButton>
      </div>
    </div>

    <!-- 加载中 -->
    <div v-if="pending" class="space-y-4">
      <div class="h-32 animate-pulse rounded-lg bg-surface-muted" />
      <div class="h-64 animate-pulse rounded-lg bg-surface-muted" />
    </div>

    <!-- 错误 / 404 -->
    <div v-else-if="error || !consumable" class="rounded-lg bg-surface-raised p-12 text-center ring-1 ring-line">
      <UIcon name="i-lucide-alert-octagon" class="mx-auto h-12 w-12 text-alert-400" />
      <h3 class="mt-4 text-lg font-semibold text-ink">耗材不存在</h3>
      <p class="mt-1 text-sm text-ink-tertiary">
        {{ error?.message || '未找到该耗材记录' }}
      </p>
      <UButton to="/consumables" icon="i-lucide-list" color="primary" variant="outline" size="sm" class="mt-4">
        返回列表
      </UButton>
    </div>

    <template v-else>
      <!-- 基本信息 -->
      <div class="rounded-lg bg-surface-raised ring-1 ring-line">
        <div class="flex items-center gap-2 border-b border-line px-5 py-4">
          <UIcon name="i-lucide-info" class="h-5 w-5 text-action" />
          <h3 class="text-sm font-semibold text-ink">基本信息</h3>
        </div>
        <div class="grid grid-cols-2 gap-x-6 gap-y-4 p-5 md:grid-cols-3">
          <div>
            <dt class="text-xs text-ink-tertiary">品牌</dt>
            <dd class="mt-1 text-ink">{{ consumable.brand || '-' }}</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-tertiary">型号</dt>
            <dd class="mt-1 font-medium text-ink">{{ consumable.model }}</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-tertiary">状态</dt>
            <dd class="mt-1">
              <span
                :class="[STATUS_STYLES[consumable.status], 'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium']"
              >
                {{ STATUS_LABELS[consumable.status] }}
              </span>
            </dd>
          </div>
          <div v-if="consumable.location_a || consumable.location_b || consumable.location_c">
            <dt class="text-xs text-ink-tertiary">库位</dt>
            <dd class="mt-1 text-action">
              <template v-if="consumable.location_a">{{ consumable.location_a }}</template>
              <template v-if="consumable.location_a && (consumable.location_b || consumable.location_c)">-</template>
              <template v-if="consumable.location_b">{{ consumable.location_b }}</template>
              <template v-if="consumable.location_b && consumable.location_c">-</template>
              <template v-if="consumable.location_c">{{ consumable.location_c }}</template>
            </dd>
          </div>
          <div class="md:col-span-2">
            <dt class="text-xs text-ink-tertiary">序列号</dt>
            <dd class="mt-1 flex items-center gap-2">
              <span class="font-mono text-ink-secondary">{{ consumable.serial_number || '-' }}</span>
              <UButton
                v-if="consumable.serial_number"
                :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
                color="neutral"
                variant="ghost"
                size="xs"
                @click="copySn"
              >
                {{ copied ? '已复制' : '复制' }}
              </UButton>
            </dd>
          </div>
          <div class="md:col-span-2">
            <dt class="text-xs text-ink-tertiary">商品条码</dt>
            <dd class="mt-1">
              <span class="font-mono text-notice-400">{{ consumable.barcode || '-' }}</span>
            </dd>
          </div>
          <div v-if="consumable.production_date">
            <dt class="text-xs text-ink-tertiary">生产日期</dt>
            <dd class="mt-1 font-mono text-ink">{{ consumable.production_date }}</dd>
          </div>
          <div v-if="consumable.expiry_date">
            <dt class="text-xs text-ink-tertiary">失效日期</dt>
            <dd class="mt-1 font-mono text-ink">{{ consumable.expiry_date }}</dd>
          </div>
          <div v-if="consumable.batch_number">
            <dt class="text-xs text-ink-tertiary">批号</dt>
            <dd class="mt-1 font-mono text-ink">{{ consumable.batch_number }}</dd>
          </div>
          <div v-if="consumable.shelf_life">
            <dt class="text-xs text-ink-tertiary">保质期</dt>
            <dd class="mt-1 text-ink">{{ consumable.shelf_life }}</dd>
          </div>
          <div v-if="expiryDate">
            <dt class="text-xs text-ink-tertiary">过期日期</dt>
            <dd class="mt-1 flex items-center gap-2 font-mono text-notice-400">
              {{ expiryDate }}
              <span
                v-if="expiryWarn"
                class="inline-flex animate-pulse items-center rounded-md bg-alert-500 px-2 py-0.5 text-xs font-bold text-on-button ring-1 ring-alert-400"
              >
                {{ expiryWarn.level === 'expired' ? `已过期 ${expiryWarn.days} 天` : `${expiryWarn.days} 天后过期` }}
              </span>
            </dd>
          </div>
          <div v-if="consumable.exec_standard">
            <dt class="text-xs text-ink-tertiary">执行标准</dt>
            <dd class="mt-1 font-mono text-ink">{{ consumable.exec_standard }}</dd>
          </div>
          <div v-if="consumable.net_content">
            <dt class="text-xs text-ink-tertiary">净含量</dt>
            <dd class="mt-1 text-ink">{{ consumable.net_content }}</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-tertiary">创建时间</dt>
            <dd class="mt-1 font-mono text-xs text-ink-secondary">{{ formatDate(consumable.created_at) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-tertiary">更新时间</dt>
            <dd class="mt-1 font-mono text-xs text-ink-secondary">{{ formatDate(consumable.updated_at) }}</dd>
          </div>
          <div v-if="consumable.note" class="md:col-span-3">
            <dt class="text-xs text-ink-tertiary">备注</dt>
            <dd class="mt-1 rounded-md bg-surface-muted p-3 text-sm text-ink-secondary whitespace-pre-wrap">{{ consumable.note }}</dd>
          </div>
        </div>
      </div>
    </template>

    <!-- 改备注对话框 -->
    <UModal v-model:open="showNoteModal" title="修改备注">
      <template #body>
        <div class="space-y-3">
          <UTextarea
            v-model="noteText"
            placeholder="输入备注内容..."
            :rows="4"
          />
          <div v-if="noteError" class="rounded-md bg-alert-500/10 p-3 text-sm text-alert-300 ring-1 ring-alert-500/20">
            {{ noteError }}
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="savingNote" @click="showNoteModal = false">
            取消
          </UButton>
          <UButton color="primary" variant="solid" :loading="savingNote" @click="saveNote">
            保存
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 编辑附加信息对话框 -->
    <UModal v-model:open="showExtraModal" title="编辑附加信息">
      <template #body>
        <div class="space-y-3">
          <div v-if="extraError" class="rounded-md bg-alert-500/10 p-3 text-sm text-alert-300 ring-1 ring-alert-500/20">
            {{ extraError }}
          </div>
          <div>
            <label class="mb-1 block text-xs text-ink-tertiary">生产日期</label>
            <UInput v-model="extraForm.production_date" type="date" class="w-full font-mono" />
          </div>
          <div>
            <label class="mb-1 block text-xs text-ink-tertiary">失效日期（填了则保质期仅作备注）</label>
            <UInput v-model="extraForm.expiry_date" type="date" class="w-full font-mono" />
          </div>
          <div>
            <label class="mb-1 block text-xs text-ink-tertiary">批号</label>
            <UInput v-model="extraForm.batch_number" placeholder="医药/化工产品批号" class="w-full font-mono" />
          </div>
          <div>
            <label class="mb-1 block text-xs text-ink-tertiary">保质期</label>
            <UInput v-model="extraForm.shelf_life" placeholder="如: 24个月 / 2027-06" class="w-full" />
          </div>
          <div>
            <label class="mb-1 block text-xs text-ink-tertiary">执行标准</label>
            <UInput v-model="extraForm.exec_standard" placeholder="如: GB/T 2423.1" class="w-full font-mono" />
          </div>
          <div>
            <label class="mb-1 block text-xs text-ink-tertiary">净含量</label>
            <UInput v-model="extraForm.net_content" placeholder="如: 100g / 500ml" class="w-full" />
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="savingExtra" @click="showExtraModal = false">
            取消
          </UButton>
          <UButton color="primary" variant="solid" :loading="savingExtra" @click="saveExtra">
            保存
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 改状态对话框 -->
    <UModal v-model:open="showStatusModal" title="修改耗材状态">
      <template #body>
        <div class="space-y-3">
          <USelect
            v-model="newStatus"
            :items="[
              { label: '储备中', value: 'in_stock' },
              { label: '使用中', value: 'in_use' }
            ]"
            class="w-full"
          />
          <div v-if="statusError" class="rounded-md bg-alert-500/10 p-3 text-sm text-alert-300 ring-1 ring-alert-500/20">
            {{ statusError }}
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="savingStatus" @click="showStatusModal = false">
            取消
          </UButton>
          <UButton color="primary" variant="solid" :loading="savingStatus" @click="saveStatus">
            保存
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 删除确认对话框 -->
    <UModal v-model:open="showDeleteModal" :title="`删除 ${consumable?.model || '耗材'}？`">
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-ink-secondary">此操作不可恢复。</p>
          <div v-if="consumable" class="rounded-md bg-surface-muted p-3 font-mono text-xs text-ink-secondary">
            <div>品牌：{{ consumable.brand || '-' }}</div>
            <div>型号：{{ consumable.model }}</div>
            <div>序列号：{{ consumable.serial_number || '-' }}</div>
            <div>状态：{{ STATUS_LABELS[consumable.status] }}</div>
          </div>
          <div v-if="deleteError" class="rounded-md bg-alert-500/10 p-3 text-sm text-alert-300 ring-1 ring-alert-500/20">
            {{ deleteError }}
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="deleting" @click="showDeleteModal = false">
            取消
          </UButton>
          <UButton color="error" variant="solid" :loading="deleting" @click="confirmDelete">
            确认删除
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 打印标签对话框 -->
    <PrintLabelModal v-model:open="showPrintModal" mode="consumable" :consumable="consumable" />
  </div>
</template>
