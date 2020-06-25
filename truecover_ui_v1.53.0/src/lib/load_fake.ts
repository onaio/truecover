import deepFreeze from '@ef-carbon/deep-freeze';
import { algos } from '@/config/algos';
import store, { MUTATIONS } from '@/store';

// @ts-ignore
import { fake_result } from '@/sample_data/pp.poly.resp';
import { geodata_carrier } from './data/geodata_carrier';
import { ResultConfig, AggregateBy} from '@/types';
import config from '@/config/config';
const algo = algos.find((a) => a.fn_name === 'fn-prevalence-predictor');
// import {fake_result} from '@/sample_data/as.poly.resp';
// const algo = algos.find((a) => a.fn_name === 'fn-adaptive-sampling');

const result_config: ResultConfig = {
  aggregate_by: AggregateBy.HEXGRIDS,
  viz_def: algo!.visualisations[0],
  grid_size_km: config.map.grid_size_km,
};

export function load_fake() {
  console.warn('Adding fake data');

  store.commit(MUTATIONS.set_algo, algo);
  store.commit(MUTATIONS.set_params, {});
  store.commit(MUTATIONS.set_result, deepFreeze(fake_result));
  store.commit(MUTATIONS.set_result_config, result_config);
  geodata_carrier.set(fake_result!.result);
}
