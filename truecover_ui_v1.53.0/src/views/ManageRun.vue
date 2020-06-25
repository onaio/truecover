<template>
  <div>
    <StepNumber>
      <template v-slot:number>3</template>
      Manage run
    </StepNumber>

    <div v-if="algo && params">
      <div v-if="run_invocation_status === RunInvocationStatus.NotStarted">
        <div>Run not started</div>
        <div class="row">
          <div class="col">
            <q-btn unelevated no-caps color="primary" label="Start run" @click="start_run" />
          </div>
        </div>
      </div>

      <div v-if="run_invocation_status === RunInvocationStatus.Running">
        <div>Running (started at {{ timestamp() }})</div>
        <q-linear-progress indeterminate />
      </div>

      <div v-if="run_invocation_status === RunInvocationStatus.Finished">
        <div v-if="error_message.length > 0">There was an error : {{ error_message }}</div>
        <div v-else>
          Run ({{ run_id }}) finished at
          {{ timestamp(this.result.finshed_at) }}
        </div>
      </div>
    </div>

    <div v-else>Waiting to select algorithm and configure params</div>
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import mixins from 'vue-typed-mixins';
import dayjs from 'dayjs';
import deep_freeze, { deepFreeze } from '@ef-carbon/deep-freeze';

import {
  RunInvocationStatus,
  RunRequest,
  RunRequestParams,
  RunResponse,
} from '@/types';
import { app_data } from '@/lib/mixins/app_data.mixin';
import { invoke_run } from '@/lib/data/wiring';
import { omit, cloneDeep } from 'lodash';
import { geodata_carrier } from '@/lib/data/geodata_carrier';
import { MUTATIONS } from '@/store';
import StepNumber from '@/views/StepNumber.vue';

export default mixins(app_data).extend({
  components: { StepNumber },
  data() {
    return {
      error_message: '',
      run_invocation_status: RunInvocationStatus.NotStarted as RunInvocationStatus,
      // helpers
      RunInvocationStatus,
      run_id: '' as string | null,
    };
  },
  created() {
    if (this.result) {
      // Mostly for debugging
      this.run_invocation_status = RunInvocationStatus.Finished;
    }
  },
  methods: {
    timestamp(date?: Date): string {
      if (!date) {
        date = new Date();
      }
      return dayjs(date).format('HH:mm [(UTC]Z[)]');
    },
    load_data() {
      const result = {
        function_status: 'success',
        result: geodata_carrier.get_original(),
      };
      this.run_id = 'preprocessed data';

      this.run_invocation_status = RunInvocationStatus.Finished;

      this.$store.commit(MUTATIONS.set_result, result);
    },
    async start_run() {
      this.run_invocation_status = RunInvocationStatus.Running;

      const point_data = geodata_carrier.points;
      if (!point_data) {
        return console.error('Missing point data');
      }

      const params_for_request: RunRequestParams = {
        ...this.params,
        point_data,
      };

      const run_request: RunRequest = {
        algo: this.algo,
        params: params_for_request,
        started_at: new Date(),
        finished_at: null,
      };

      // This does the whole run invocation!

      const result = await invoke_run(run_request);
      // console.log(result.result.function_status);
      if (result.function_status === 'error') {
        this.run_invocation_status = RunInvocationStatus.Finished;
        this.error_message = result.result;
        return;
      }

      if (result.function_status === 'success') {
        geodata_carrier.update(result.result);
        result.result = geodata_carrier.get_original();
      }

      if (!result.headers) {
        return console.error('Result headers not found');
      }
      this.run_id = result.headers.get('uuid');

      this.run_invocation_status = RunInvocationStatus.Finished;

      this.$store.commit(MUTATIONS.set_result, result);
    },
  },
});
</script>

<style scoped>
.load-btn-style {
  float: right;
  color: grey;
}
</style>
