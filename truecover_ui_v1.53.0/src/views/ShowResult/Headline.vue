<template>
  <div class='headline' v-if='measure && value'>
    <div class='value'>{{value}}</div>
    <div class='measure'>{{measure}}</div>
  </div>
</template>

<script lang='ts'>
import Vue from 'vue';
import mixins from 'vue-typed-mixins';

import { app_data } from '@/lib/mixins/app_data.mixin';
import { ResultConfig, RunResponse } from '@/types';
import { function_from_aggregation_def } from '@/lib/viz/grid_layer';
import config from '@/config/config';

export default mixins(app_data).extend({
  data() {
    return {
      measure: null as null | string,
      value: null as null | string,
    };
  },
  watch: {
    result_config: 'calculate_mean',
  },
  mounted() {
    // TODO: remove from mounted
    this.calculate_mean();
  },
  methods: {
    calculate_mean() {
      this.measure = null;
      this.value = null;

      const result_config: ResultConfig = this.result_config;
      const result: RunResponse = this.result;
      this.headline = '';
      if (!result_config) {
        return;
      }

      const agg = result_config.viz_def.modes.aggregation ? result_config.viz_def.modes.aggregation : null;
      if (!agg) {
        return;
      }

      const fn = function_from_aggregation_def(agg.function);
      const attribute = result_config.viz_def.attribute ? result_config.viz_def.attribute : null;
      if (!attribute) {
        return;
      }

      const attribute_field = attribute.field;
      const calculated = fn(result.result, attribute_field);
      if (!calculated) {
        return;
      }

      const formatted = calculated.toFixed(config.display.defaults.numeric_precision);

      this.measure = agg.measure;
      this.value = formatted;
    },
  },
});
</script>

<style scoped>
.headline {
  font-size: 1.9em;
  color: grey;
  font-weight: bold;
  text-align: right;
}
.measure {
  font-size: 0.55em;
  font-weight: normal;
}
</style>