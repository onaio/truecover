import { Algo } from '@/types';
import { visualisations } from '@/config/visualisations';

export const algos: Algo[] = [
  {
    fn_name: 'fn-adaptive-sampling',
    title: 'Adaptive sampling',
    intent: 'Recommend sampling locations',
    description: `Generates recommendations for best sampling or survey locations.
    Existing results are used if they exist.
    If not, a random, but distributed sample is created.`,
    fields: [
      // `exceedance_uncertainty` only required if `uncertainty_fieldname` is set to
      // `exceedance_uncertainty`!
      { field_name: 'exceedance_uncertainty', required: false, type: 'number' },
    ],
    params: [
      {
        name: 'batch_size',
        type: 'number',
        default: 10,
      }, {
        name: 'uncertainty_fieldname',
        required: false,
        type: 'string',
        default: 'exceedance_uncertainty',
      },
    ],
    return_fields: [
      { field_name: 'adaptively_selected', type: 'boolean' },
    ],
    remote: true,
    visualisations: [visualisations.sampling],
  },
  {
    fn_name: 'fn-prevalence-predictor',
    title: 'Coverage predictor',
    intent: 'Generate coverage map',
    description: 'Predict coverage at all sites based on existing survey data.',
    fields: [
      { field_name: 'n_trials', required: true, type: 'number' },
      { field_name: 'n_positive', required: true, type: 'number' },
    ],
    params: [
      {
        name: 'exceedance_threshold',
        required: false,
        type: 'number',
      },
      {
        name: 'layer_names',
        required: false,
        type: 'array',
      },
    ],
    return_fields: [
      { field_name: 'prediction', type: 'number' },
      { field_name: 'bci_width', type: 'number' },
      { field_name: 'exceedance_probability', type: 'number' },
      { field_name: 'exceedance_uncertainty', type: 'number' },
    ],
    remote: true,
    visualisations: [visualisations.coverage, visualisations.confidence],
  },
];
