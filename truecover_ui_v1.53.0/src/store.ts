import Vue from 'vue';
import Vuex, { StoreOptions } from 'vuex';

import { VisualisationDefinition, Algo, RunRequestParams, ResultConfig, RunResponse, BaseLayer } from '@/types';
import config from '@/config/config';

Vue.use(Vuex);

export interface RootState {
  algo: null | Algo;
  params: null | RunRequestParams;
  result: null | RunResponse;
  result_config: null | ResultConfig;
  grid_size_km: number;
  baselayer: BaseLayer;
  viz_def: null | VisualisationDefinition;
  bin_polygons: any;

}

export enum MUTATIONS {
  set_algo = 'set_algo',
  set_params = 'set_params',
  set_result = 'set_result',
  set_result_config = 'set_result_config',
  set_grid_size_km = 'set_grid_size_km',
  set_baselayer = 'set_baselayer',
  set_viz_def = 'set_viz_def',
  set_bin_polygons = 'set_bin_polygons',

}

const store_options: StoreOptions<RootState> = {
  state: {
    algo: null,
    params: null,
    result: null,
    result_config: null,
    grid_size_km: config.map.grid_size_km,
    baselayer: config.map.baselayer_styles[0],
    viz_def: null,
    bin_polygons: null,
  },
  mutations: {
    [MUTATIONS.set_algo](state, algo) {
      state.algo = algo;
    },
    [MUTATIONS.set_params](state, params) {
      state.params = params;
    },
    [MUTATIONS.set_result](state, result) {
      state.result = result;
    },
    [MUTATIONS.set_result_config](state, result_config) {
      state.result_config = result_config;
    },
    [MUTATIONS.set_grid_size_km](state, grid_size_km) {
      state.grid_size_km = grid_size_km;
    },
    [MUTATIONS.set_baselayer](state, baselayer) {
      state.baselayer = baselayer;
    },
    [MUTATIONS.set_viz_def](state, viz_def) {
      state.viz_def = viz_def;
    },
    [MUTATIONS.set_bin_polygons](state, bin_polygons) {
      state.bin_polygons = bin_polygons;
    },
  },
  actions: {
  },
};

export default new Vuex.Store(store_options);

