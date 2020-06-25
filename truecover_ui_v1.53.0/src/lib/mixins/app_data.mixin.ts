import Vue from 'vue';
import { mapState } from 'vuex';

import { RootState } from '@/store';
import { ResultConfig } from '@/types';

export const app_data = Vue.extend({
  computed: {
    ...mapState({
      algo(state: RootState) {
        return state.algo;
      },
      params(state: RootState) {
        return state.params;
      },
      result(state: RootState) {
        return state.result;
      },
      result_config(state: RootState): null | ResultConfig {
        return state.result_config;
      },
      base_layer(state: RootState) {
        return state.baselayer;
      },
    }),
  },
});
