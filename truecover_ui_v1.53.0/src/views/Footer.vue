<template>
  <div class="version">
    <span @click="show_api_key = !show_api_key">v{{version}}-{{commit_hash}}</span>
    {{show_api_key ? `API Key : ${api_key} BUILD_CONTEXT: ${context || 'unknown'}` : ''}}
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import config from '@/config/config';

// @ts-ignore
const version = APPLICATION_VERSION;
// @ts-ignore
const commit_hash = COMMIT_HASH;
// @ts-ignore
const context = CONTEXT;

export default Vue.extend({
  data() {
    return {
      version,
      commit_hash,
      api_key: config.api.key,
      show_api_key: false,
      context,
    };
  },
});
</script>

<style scoped>
.version {
  color: grey;
}
</style>
