<script setup lang="ts">
import type { CircuitBoard, CircuitBoardStatus } from '~~/shared/types'

const route = useRoute()
const boardId = route.params.id as string

const { data: board, pending, error, refresh } = await useFetch<CircuitBoard>(`/api/boards/${boardId}`)

const STATUS_LABELS: Record<CircuitBoardStatus, string> = {
  pending: '待拆解',
  partial: '部分拆解',
  done: '已拆解'
}

const STATUS_STYLES: Record<CircuitBoardStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30',
  partial: 'bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/30',
  done: 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30'
}

// ---- 改备注 ----
const showNoteModal = ref(false)
const noteText = ref('')
const savingNote = ref(false)
const noteError = ref<string | null>(null)

async function saveNote() {
  if (!board.value) return
  savingNote.value = true
  noteError.value = null
  try {
    await $fetch(`/api/boards/${board.value.id}`, {
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
const newStatus = ref<CircuitBoardStatus>('pending')
const savingStatus = ref(false)
const statusError = ref<string | null>(null)

function openStatusModal() {
  if (!board.value) return
  newStatus.value = board.value.status
  statusError.value = null
  showStatusModal.value = true
}

async function saveStatus() {
  if (!board.value) return
  savingStatus.value = true
  statusError.value = null
  try {
    await $fetch(`/api/boards/${board.value.id}`, {
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
  if (!board.value) return
  deleting.value = true
  deleteError.value = null
  try {
    await $fetch(`/api/boards/${board.value.id}`, { method: 'DELETE' })
    showDeleteModal.value = false
    await navigateTo('/boards')
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
          to="/boards"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          size="sm"
        />
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-xl font-bold text-slate-100">
              {{ board?.model || '电路板详情' }}
            </h2>
            <UBadge
              v-if="board?.brand"
              color="blue"
              variant="subtle"
              size="xs"
            >
              {{ board.brand }}
            </UBadge>
            <span
              v-if="board"
              :class="[STATUS_STYLES[board.status], 'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium']"
            >
              {{ STATUS_LABELS[board.status] }}
            </span>
          </div>
          <p v-if="board" class="mt-1 font-mono text-xs text-slate-500">
            ID: {{ board.id }}
          </p>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton
          v-if="board"
          icon="i-lucide-pen-line"
          color="neutral"
          variant="outline"
          size="sm"
          @click="noteText = board.note || ''; showNoteModal = true"
        >
          改备注
        </UButton>
        <UButton
          v-if="board"
          icon="i-lucide-activity"
          color="amber"
          variant="outline"
          size="sm"
          @click="openStatusModal"
        >
          改状态
        </UButton>
        <UButton
          v-if="board"
          icon="i-lucide-printer"
          color="amber"
          variant="solid"
          size="sm"
          @click="showPrintModal = true"
        >
          打印标签
        </UButton>
        <UButton
          v-if="board"
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
          v-if="board"
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
      <div class="h-32 animate-pulse rounded-lg bg-white/5" />
      <div class="h-64 animate-pulse rounded-lg bg-white/5" />
    </div>

    <!-- 错误 / 404 -->
    <div v-else-if="error || !board" class="rounded-lg bg-[#1e1e3a] p-12 text-center ring-1 ring-white/5">
      <UIcon name="i-lucide-alert-octagon" class="mx-auto h-12 w-12 text-red-400" />
      <h3 class="mt-4 text-lg font-semibold text-slate-200">电路板不存在</h3>
      <p class="mt-1 text-sm text-slate-500">
        {{ error?.message || '未找到该电路板记录' }}
      </p>
      <UButton to="/boards" icon="i-lucide-list" color="primary" variant="outline" size="sm" class="mt-4">
        返回列表
      </UButton>
    </div>

    <template v-else>
      <!-- 基本信息 -->
      <div class="rounded-lg bg-[#1e1e3a] ring-1 ring-white/5">
        <div class="flex items-center gap-2 border-b border-white/5 px-5 py-4">
          <UIcon name="i-lucide-info" class="h-5 w-5 text-cyan-400" />
          <h3 class="text-sm font-semibold text-slate-200">基本信息</h3>
        </div>
        <div class="grid grid-cols-2 gap-x-6 gap-y-4 p-5 md:grid-cols-3">
          <div>
            <dt class="text-xs text-slate-500">品牌</dt>
            <dd class="mt-1 text-slate-200">{{ board.brand || '-' }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500">型号</dt>
            <dd class="mt-1 font-medium text-slate-200">{{ board.model }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500">拆解状态</dt>
            <dd class="mt-1">
              <span
                :class="[STATUS_STYLES[board.status], 'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium']"
              >
                {{ STATUS_LABELS[board.status] }}
              </span>
            </dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500">序列号</dt>
            <dd class="mt-1 font-mono text-slate-300">{{ board.serial_number || '-' }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500">创建时间</dt>
            <dd class="mt-1 font-mono text-xs text-slate-400">{{ formatDate(board.created_at) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500">更新时间</dt>
            <dd class="mt-1 font-mono text-xs text-slate-400">{{ formatDate(board.updated_at) }}</dd>
          </div>

          <!-- 板载芯片（全宽，chip 徽章列表） -->
          <div class="md:col-span-3">
            <dt class="text-xs text-slate-500">板载主要芯片</dt>
            <dd class="mt-2">
              <div v-if="board.chips?.length" class="flex flex-wrap gap-1.5">
                <span
                  v-for="(c, i) in board.chips"
                  :key="i"
                  class="rounded-md bg-cyan-500/15 px-2 py-1 font-mono text-xs text-cyan-300 ring-1 ring-cyan-500/30"
                >
                  {{ c }}
                </span>
              </div>
              <span v-else class="text-slate-500">未记录</span>
            </dd>
          </div>

          <div v-if="board.note" class="md:col-span-3">
            <dt class="text-xs text-slate-500">备注</dt>
            <dd class="mt-1 rounded-md bg-white/5 p-3 text-sm text-slate-300 whitespace-pre-wrap">{{ board.note }}</dd>
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
          <div v-if="noteError" class="rounded-md bg-red-500/10 p-3 text-sm text-red-300 ring-1 ring-red-500/20">
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
    <UModal v-model:open="showStatusModal" title="修改电路板状态">
      <template #body>
        <div class="space-y-3">
          <USelect
            v-model="newStatus"
            :items="[
              { label: '待拆解', value: 'pending' },
              { label: '部分拆解', value: 'partial' },
              { label: '已拆解', value: 'done' }
            ]"
            class="w-full"
          />
          <div v-if="statusError" class="rounded-md bg-red-500/10 p-3 text-sm text-red-300 ring-1 ring-red-500/20">
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
    <UModal v-model:open="showDeleteModal" :title="`删除 ${board?.model || '电路板'}？`">
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-slate-300">此操作不可恢复。</p>
          <div v-if="board" class="rounded-md bg-white/5 p-3 font-mono text-xs text-slate-400">
            <div>品牌：{{ board.brand || '-' }}</div>
            <div>型号：{{ board.model }}</div>
            <div>序列号：{{ board.serial_number || '-' }}</div>
            <div>状态：{{ STATUS_LABELS[board.status] }}</div>
            <div v-if="board.chips?.length">芯片：{{ board.chips.join(', ') }}</div>
          </div>
          <div v-if="deleteError" class="rounded-md bg-red-500/10 p-3 text-sm text-red-300 ring-1 ring-red-500/20">
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
    <PrintLabelModal v-model:open="showPrintModal" mode="board" :board="board" />
  </div>
</template>
