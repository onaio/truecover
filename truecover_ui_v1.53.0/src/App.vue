<template>
  <div class="container">
    <div class="row justify-between">
      <div class="col title">True Cover</div>
      <div class="col">
        <Reset />
      </div>
    </div>

    <div v-if="!api_key">API Key not set. Please get in touch with hello@peoplesized.com</div>

    <div v-else>
      <PickAlgorithm :class="{'active-step': active_step === 0}" class="step" />
      <ConfigureRun :class="{'active-step': active_step === 1}" class="step" />
      <ManageRun :class="{'active-step': active_step === 2}" class="step" />
      <ConfigureResult :class="{'active-step': active_step === 3}" class="step" />
      <ShowResult :class="{'active-step': active_step === 4}" class="step" />
    </div>
    <Footer />
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import deep_freeze from '@ef-carbon/deep-freeze';
import { FeatureCollection } from '@turf/helpers';
import mixins from 'vue-typed-mixins';

import Reset from '@/views/Reset.vue';
import PickAlgorithm from '@/views/PickAlgorithm.vue';
import ConfigureRun from '@/views/ConfigureRun.vue';
import ManageRun from '@/views/ManageRun.vue';
import ConfigureResult from '@/views/ConfigureResult.vue';
import ShowResult from '@/views/ShowResult.vue';
import Footer from '@/views/Footer.vue';
import { algos } from '@/config/algos';
import { RunResponse, Algo, RunRequestParams, RunRequest, ResultConfig } from '@/types';
import { geodata_carrier } from '@/lib/data/geodata_carrier';
import { app_data } from './lib/mixins/app_data.mixin';
import config from '@/config/config';

export default mixins(app_data).extend({
  components: { Reset, PickAlgorithm, ConfigureRun, ManageRun, ConfigureResult, ShowResult, Footer },
  data() {
    return {
      api_key: config.api.key,
    };
  },
  computed: {
    active_step(): number {
      if (this.result && this.result_config !== null) {
        return 4; // Steps.ShowResult;
      } else if (this.result && !this.result_config) {
        return 3; // Steps.ConfigureResult;
      } else if (this.algo && this.params && !this.result) {
        return 2; // Steps.ManageRun;
      } else if (this.algo && !this.params && !this.result) {
        return 1; // Steps.ConfigureRun;
      } else if (!this.algo && !this.params && !this.result) {
        return 0; // Steps.PickAlgorithm;
      }
      console.error('No step?');
      return 0; // Steps.PickAlgorithm;
    },
  },
});
</script>

<style scoped>
.title {
  color: grey;
  font-size: 1.4em;
  font-weight: 600;
}
.container {
  width: 80%;
  margin: 10px auto;
}
.step {
  background-color: #f7f7f7;
  margin-bottom: 20px;
  padding: 10px;
  border: 2px solid lightgrey;
  border-radius: 3px;
}
.step.active-step {
  background-color: white;
  border: 2px solid #ff9800;
}
.version {
  color: lightgray;
}
</style>


