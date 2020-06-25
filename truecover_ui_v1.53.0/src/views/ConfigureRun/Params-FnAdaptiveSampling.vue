<template>
  <div>
    <q-input
      style="max-width: 400px;"
      outlined
      v-model.number="specific_params.batch_size"
      label="How many recommendations do you want?"
      type="number"
      lazy-rules
      :rules="[ val => (val === null || val > 0) || 'Must be above 0']"
    />
    <q-input
      style="max-width: 400px;"
      outlined
      v-model="specific_params.uncertainty_fieldname"
      label="What field contains uncertainty estimate?"
    />

    <div class="options">
      <span @click="specific_params.uncertainty_fieldname = 'bci_width'">bci_width</span> |
      <span
        @click="specific_params.uncertainty_fieldname = 'exceedance_uncertainty'"
      >exceedance_uncertainty</span>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import mixins from 'vue-typed-mixins';

import { params_mixin } from '@/lib/mixins/params.mixin';

export default mixins(params_mixin).extend({
  data() {
    return {
      default_params: {
        batch_size: 10,
        uncertainty_fieldname: 'bci_width',
      },
    };
  },
});
</script>

<style scoped>
.options {
  max-width: 400px;
  text-align: right;
  font-size: 0.8em;
  color: grey;
  cursor: pointer;
}
</style>
