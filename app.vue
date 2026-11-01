<script setup lang="ts">
useHead({
  htmlAttrs: {
    class: 'dark',
    'data-theme': 'dark'
  }
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
