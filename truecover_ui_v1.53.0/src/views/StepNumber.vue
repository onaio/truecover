<template>
  <div class="step-number">
    <strong><slot name='number'></slot></strong>
    <slot></slot>
  </div>
</template>

<script lang='ts'>
import Vue from 'vue';

export default Vue.extend({});
</script>

<style scoped lang="css">
.step-number {
  color: white;
  background: lightgray;
  margin: -10px -10px 5px -10px;
  font-size: 1.5em;
  padding: 5px;
}
.step-number > strong {
  color: white;
}
.active-step > .step-number {
  color: white;
  background: #ff9800;
}
.active-step > .step-number > strong {
  color: #ffd28f;
}
</style>