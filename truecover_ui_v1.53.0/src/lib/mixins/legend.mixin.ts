import Vue from 'vue';
import { Layer } from 'mapbox-gl';
import { VisualisationDefinition, VisualisationMode, VisualisationLayer } from '@/types';

export const legend = Vue.extend({
  props: {
    viz: {
      type: Object as () => VisualisationLayer,
    },
  },
  computed: {
    layer(): Layer {
      return this.viz.layer;
    },
    viz_def(): null | VisualisationDefinition {
      if (!this.viz.options.viz_def) {
        return null;
      }
      return this.viz.options.viz_def;
    },
    viz_mode(): VisualisationMode {
      return this.viz.options.viz_mode;
    },
  },
});
