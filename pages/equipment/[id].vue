<script setup lang="ts">
import type { Equipment, EquipmentStatus } from '~~/shared/types'

const route = useRoute()
const equipId = route.params.id as string

const { data: equip, pending, error, refresh } = await useFetch<Equipment>(`/api/equipment/${equipId}`)

const STATUS_LABELS: Record<EquipmentStatus, string> = {
  normal: '正常',
  damaged: '损坏',
  lost: '丢失'
}

const STATUS_STYLES: Record<EquipmentStatus, string> = {
  normal: 'bg-gain-500/15 text-gain-400 ring-1 ring-gain-500/30',
  damaged: 'bg-notice-500/15 text-notice-400 ring-1 ring-notice-500/30',
  lost: 'bg-alert-500/15 text-alert-400 ring-1 ring-alert-500/30'
}

const copied = ref(false)

async function copySn() {
  if (!equip.value?.serial_number) return
  try {
    await navigator.clipboard.writeText(equip.value.serial_number)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch { /* ignore */ }
}

// ---- 改备注 ----
const showNoteModal = ref(false)
const noteText = ref('')
const savingNote = ref(false)
const noteError = ref<string | null>(null)

async function saveNote() {
  if (!equip.value) return
  savingNote.value = true
  noteError.value = null
  try {
    await $fetch(`/api/equipment/${equip.value.id}`, {
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
const newStatus = ref<EquipmentStatus>('normal')
const savingStatus = ref(false)
const statusError = ref<string | null>(null)

function openStatusModal() {
  if (!equip.value) return
  newStatus.value = equip.value.status
  statusError.value = null
  showStatusModal.value = true
}

async function saveStatus() {
  if (!equip.value) return
  savingStatus.value = true
  statusError.value = null
  try {
    await $fetch(`/api/equipment/${equip.value.id}`, {
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
  if (!equip.value) return
  deleting.value = true
  deleteError.value = null
  try {
    await $fetch(`/api/equipment/${equip.value.id}`, { method: 'DELETE' })
    showDeleteModal.value = false
    await navigateTo('/equipment')
  } catch (err: any) {
    deleteError.value = err?.statusMessage || err?.message || '删除失败'
  } finally {
    deleting.value = false
  }
}

// ---- 打印标签 ----
const showPrintModal = ref(false)
</script>

<template>
  <div class="min-h-full p-6">
    <!-- 页头 -->
    <div class="mb-6 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <UButton
          to="/equipment"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          size="sm"
        />
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-xl font-bold text-ink">
              {{ equip?.model || '设备详情' }}
            </h2>
            <UBadge
              v-if="equip?.brand"
              color="data"
              variant="subtle"
              size="xs"
            >
              {{ equip.brand }}
            </UBadge>
            <span
              v-if="equip"
              :class="[STATUS_STYLES[equip.status], 'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium']"
            >
              {{ STATUS_LABELS[equip.status] }}
            </span>
          </div>
          <p v-if="equip" class="mt-1 font-mono text-xs text-ink-tertiary">
            ID: {{ equip.id }}
          </p>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton
          v-if="equip"
          icon="i-lucide-pen-line"
          color="neutral"
          variant="outline"
          size="sm"
          @click="noteText = equip.note || ''; showNoteModal = true"
        >
          改备注
        </UButton>
        <UButton
          v-if="equip"
          icon="i-lucide-activity"
          color="notice"
          variant="outline"
          size="sm"
          @click="openStatusModal"
        >
          改状态
        </UButton>
        <UButton
          v-if="equip"
          icon="i-lucide-printer"
          color="notice"
          variant="solid"
          size="sm"
          @click="showPrintModal = true"
        >
          打印标签
        </UButton>
        <UButton
          v-if="equip"
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
          v-if="equip"
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
    <div v-else-if="error || !equip" class="rounded-lg bg-surface-raised p-12 text-center ring-1 ring-line">
      <UIcon name="i-lucide-alert-octagon" class="mx-auto h-12 w-12 text-alert-400" />
      <h3 class="mt-4 text-lg font-semibold text-ink">设备不存在</h3>
      <p class="mt-1 text-sm text-ink-tertiary">
        {{ error?.message || '未找到该设备记录' }}
      </p>
      <UButton to="/equipment" icon="i-lucide-list" color="primary" variant="outline" size="sm" class="mt-4">
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
            <dd class="mt-1 text-ink">{{ equip.brand || '-' }}</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-tertiary">型号</dt>
            <dd class="mt-1 font-medium text-ink">{{ equip.model }}</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-tertiary">状态</dt>
            <dd class="mt-1">
              <span
                :class="[STATUS_STYLES[equip.status], 'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium']"
              >
                {{ STATUS_LABELS[equip.status] }}
              </span>
            </dd>
          </div>
          <div class="md:col-span-2">
            <dt class="text-xs text-ink-tertiary">序列号</dt>
            <dd class="mt-1 flex items-center gap-2">
              <span class="font-mono text-ink-secondary">{{ equip.serial_number || '-' }}</span>
              <UButton
                v-if="equip.serial_number"
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
          <div>
            <dt class="text-xs text-ink-tertiary">创建时间</dt>
            <dd class="mt-1 font-mono text-xs text-ink-secondary">{{ formatDate(equip.created_at) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-tertiary">更新时间</dt>
            <dd class="mt-1 font-mono text-xs text-ink-secondary">{{ formatDate(equip.updated_at) }}</dd>
          </div>
          <div v-if="equip.note" class="md:col-span-3">
            <dt class="text-xs text-ink-tertiary">备注</dt>
            <dd class="mt-1 rounded-md bg-surface-muted p-3 text-sm text-ink-secondary whitespace-pre-wrap">{{ equip.note }}</dd>
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

    <!-- 改状态对话框 -->
    <UModal v-model:open="showStatusModal" title="修改设备状态">
      <template #body>
        <div class="space-y-3">
          <USelect
            v-model="newStatus"
            :items="[
              { label: '正常', value: 'normal' },
              { label: '损坏', value: 'damaged' },
              { label: '丢失', value: 'lost' }
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
    <UModal v-model:open="showDeleteModal" :title="`删除 ${equip?.model || '设备'}？`">
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-ink-secondary">此操作不可恢复。</p>
          <div v-if="equip" class="rounded-md bg-surface-muted p-3 font-mono text-xs text-ink-secondary">
            <div>品牌：{{ equip.brand || '-' }}</div>
            <div>型号：{{ equip.model }}</div>
            <div>序列号：{{ equip.serial_number || '-' }}</div>
            <div>状态：{{ STATUS_LABELS[equip.status] }}</div>
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
    <PrintLabelModal v-model:open="showPrintModal" mode="equipment" :equipment="equip" />
  </div>
</template>
