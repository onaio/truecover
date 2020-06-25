<template>
  <div>
    <StepNumber>
      <template v-slot:number>2</template>
      Configure run
    </StepNumber>

    <div v-if="algo && !params">
      <!-- Configure Params, incl with fn-specific form -->
      <LoadFile
        :incoming_geodata="incoming_geodata"
        @set_incoming_geodata_and_filename="set_incoming_geodata_and_filename"
      />
      <component :is="algo_specific_component" @set_local_params="set_local_params" />
      <div></div>
      <q-btn unelevated color='primary' no-caps label="Done editing" @click="set_params" :disable="!incoming_geodata" />
    </div>

    <div v-else-if="algo && params">
      <div>Review params</div>

      <pre>{{params_preview}}</pre>
    </div>

    <div v-else>Waiting to select algorithm</div>
  </div>
</template>

<script lang='ts'>
import Vue from 'vue';
import mixins from 'vue-typed-mixins';
import deepFreeze from '@ef-carbon/deep-freeze';

import LoadFile from '@/views/ConfigureRun/LoadFile.vue';
import ParamsFnPrevalencePredictor from '@/views/ConfigureRun/Params-FnPrevalencePredictor.vue';
import ParamsFnAdaptiveSampling from '@/views/ConfigureRun/Params-FnAdaptiveSampling.vue';
import { app_data } from '@/lib/mixins/app_data.mixin';
import { RunRequestParams } from '@/types';
import { FeatureCollection } from '@turf/helpers';
import { omit } from 'lodash';
import { geodata_carrier } from '@/lib/data/geodata_carrier';
import { MUTATIONS } from '@/store';
import StepNumber from '@/views/StepNumber.vue';


export default mixins(app_data).extend({
  components: { LoadFile, StepNumber },
  data() {
    return {
      incoming_geodata: null as null | FeatureCollection,
      loaded_filename: null as null | string,
      local_params: null as null | any, // Object of fn-specific properties
    };
  },
  computed: {
    algo_specific_component() {
      if (this.algo && this.algo.fn_name === 'fn-adaptive-sampling') {
        return ParamsFnAdaptiveSampling;
      }
      if (this.algo && this.algo.fn_name === 'fn-prevalence-predictor') {
        return ParamsFnPrevalencePredictor;
      }
    },
    params_preview(): string {
      const features_count_or_zero = geodata_carrier.features_count_or_zero();

      const preview = {
        ...this.params,
        point_data: `<${features_count_or_zero} features from '${this.loaded_filename}'>`,
      };

      return JSON.stringify(preview, null, 2);
    },
  },
  methods: {
    set_incoming_geodata_and_filename(
      geodata: FeatureCollection,
      filename: string,
    ) {
      this.incoming_geodata = deepFreeze(geodata);
      this.loaded_filename = filename;
    },
    set_local_params(local_params: any) {
      this.local_params = local_params;
    },
    set_params() {
      if (!this.incoming_geodata) {
        return;
      }

      geodata_carrier.set(this.incoming_geodata);

      const run_request_params: RunRequestParams = {
        ...this.local_params,
        point_data: 'nothing set',
      };

      this.$store.commit(MUTATIONS.set_params, run_request_params);
    },
  },
});
</script>
