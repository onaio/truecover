<template>
  <div>
    <StepNumber>
      <template v-slot:number>5</template>
      Show result
    </StepNumber>

    <div v-if="result_config && result">
      <!-- TODO: Extract to component -->
      <div class="row">
        <div class="col">
          <q-btn
            label="Clear visualisation"
            no-caps
            outline
            color="primary"
            size="small"
            @click="clear_result_config"
          />
        </div>
        <div v-if="successful_run" class="col headline">
          <Headline />
        </div>
      </div>

      <p v-if="!successful_run">
        <em>Status:&nbsp;</em>
        <span :class="{'text-warning': !successful_run}">{{result.function_status}}</span>
      </p>

      <div v-if="successful_run">
        <div>
          <strong>Map</strong>
          <ShowMap />
        </div>

        <Download />

        <div class="result-block">
          <strong>Table</strong>
          <ShowTable class="result-block" />
        </div>
      </div>

      <p v-else>{{JSON.stringify(result.result, null, 2)}}</p>
    </div>

    <div v-else>Waiting for result and configuration</div>
  </div>
</template>

<script lang='ts'>
import Vue from 'vue';
import mixins from 'vue-typed-mixins';

import ShowMap from '@/views/ShowResult/ShowMap.vue';
import ShowTable from '@/views/ShowResult/ShowTable.vue';
import Download from '@/views/ShowResult/Download.vue';
import { feature_properties } from '@/lib/help';
import { app_data } from '@/lib/mixins/app_data.mixin';
import { geodata_carrier } from '@/lib/data/geodata_carrier';
import config from '@/config/config';
import { MUTATIONS } from '@/store';
import StepNumber from '@/views/StepNumber.vue';
import { ResultConfig, RunResponse } from '../types';
import { function_from_aggregation_def } from '@/lib/viz/grid_layer';
import Headline from '@/views/ShowResult/Headline.vue';

export default mixins(app_data).extend({
  components: { ShowMap, ShowTable, Download, StepNumber, Headline },
  computed: {
    successful_run(): boolean {
      return this.result.function_status === 'success';
    },
  },
  methods: {
    clear_result_config() {
      this.$store.commit(MUTATIONS.set_result_config, null);
    },
  },
});
</script>

<style scoped>
.result-block {
  margin-top: 20px;
}
</style>

