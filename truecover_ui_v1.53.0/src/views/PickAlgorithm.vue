<template>
  <div>
    <StepNumber>
      <template v-slot:number>1</template>
      Pick algorithm
    </StepNumber>

    <div v-if="algo">
      You've selected
      '{{algo.intent}}'
    </div>

    <div v-else>
      <div v-for="algo_def in algos" :key="algo_def.fn_name">
        <div>
          <em>{{algo_def.title}}</em>
          :
          {{algo_def.description}}
        </div>
        <div v-if="required_fields(algo_def)">
          Requirements:
          {{required_fields(algo_def).join(', ')}} are required fields.
        </div>
        <q-btn :label="algo_def.intent" unelevated no-caps color="primary" @click="set_algo(algo_def)" />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import mixins from 'vue-typed-mixins';

import { algos } from '@/config/algos';
import { AlgoField, Algo } from '@/types';
import { app_data } from '@/lib/mixins/app_data.mixin';
import { MUTATIONS } from '../store';
import StepNumber from '@/views/StepNumber.vue';

export default mixins(app_data).extend({
  components: { StepNumber },
  data() {
    return {
      // helpers
      algos,
    };
  },
  computed: {
    selected_algo_fn_name(): string {
      if (!this.algo) {
        return '';
      }
      return this.algo.fn_name;
    },
  },
  methods: {
    set_algo(algo: Algo) {
      this.$store.commit(MUTATIONS.set_algo, algo);
    },
    required_fields(algo: Algo): null | string[] {
      if (!algo || !algo.fields) {
        return null;
      }
      return algo.fields.filter((field: AlgoField) => field.required).map((field: AlgoField) => field.field_name);
    },
  },
});
</script>

