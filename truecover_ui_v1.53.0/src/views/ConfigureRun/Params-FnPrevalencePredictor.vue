<template>
  <div>
    <q-input
      style="max-width: 400px;"
      outlined
      v-model.number="specific_params.exceedance_threshold"
      label="Exceedance threshold (0 to 1)"
      type="number"
      lazy-rules
      :rules="[ val => (val === null || (val > 0 && val <= 1)) || 'Must be between 0 and 1']"
    />
    <span>Layer names</span>

    <q-select
      filled
      v-model="specific_params.layer_names"
      multiple
      :options="additional_layers"
      use-chips
      stack-label
      label="Multiple selection"
    />
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import mixins from 'vue-typed-mixins';
import { cloneDeep, pickBy, has } from 'lodash';

import { params_mixin } from '@/lib/mixins/params.mixin';
import layer_names from '@/views/ConfigureRun/LayerNames.vue';
import { LayerName } from '../../types';

export default mixins(params_mixin).extend({
  data() {
    return {
      additional_layers: layer_names,
      default_params: {
        exceedance_threshold: null,
        layer_names: null,
      } as any,
    };
  },
  methods: {
    process_params(): any {
      const non_null_params = pickBy(this.specific_params);
      const params = cloneDeep(non_null_params);
      params.layer_names = this.specific_params.layer_names?.map((i: LayerName) => i.value);
      return params;
    },
  },
});
</script>
