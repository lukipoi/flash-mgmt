<script setup lang="ts">
interface Props {
  locked: boolean
  name?: string
}

const props = withDefaults(defineProps<Props>(), {
  name: ''
})
</script>

<template>
  <div class="flex items-center gap-2">
    <span v-if="name" class="text-sm font-medium text-slate-300">{{ name }}</span>
    <UBadge
      :color="locked ? 'success' : 'neutral'"
      variant="subtle"
      size="sm"
      class="font-mono uppercase tracking-wide"
    >
      <UIcon
        :name="locked ? 'i-lucide-lock' : 'i-lucide-lock-open'"
        class="mr-1 h-3 w-3"
      />
      {{ locked ? 'LOCKED' : 'UNLOCKED' }}
    </UBadge>
  </div>
</template>
