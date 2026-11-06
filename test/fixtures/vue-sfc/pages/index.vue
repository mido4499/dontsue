<template>
  <form>
    <input v-model="email" type="email" />
    <RouterLink to="/privacy">Privacy</RouterLink>
  </form>
</template>

<script setup lang="ts">
const email = ref("");
</script>
