<template>
  <div v-if="algo">
    <p class="q-mb-xs text-weight-medium">Visualisation Options:</p>
    <div v-for="(viz_def, i) in algo.visualisations" :key="i">
      <q-radio
        @input="set_viz_def(viz_def, i)"
        :label="viz_def.title"
        :val="viz_def"
        v-model="visual_def"
      />
    </div>
  </div>
</template>

<script lang='ts'>
import Vue from 'vue';
import mixins from 'vue-typed-mixins';

import { map_support } from '@/lib/map/map_support';
import { app_data } from '@/lib/mixins/app_data.mixin';
import {
  VisualisationMode,
  VisualisationDefinition,
  LayerRequestOptions,
} from '../../types';
import { geodata_carrier } from '@/lib/data/geodata_carrier';
import config from '@/config/config';
import { MUTATIONS } from '../../store';

export default mixins(app_data).extend({
  data() {
    return {
      visual_def: null as null | VisualisationDefinition,
    };
  },
  mounted() {
    if (this.$store.state.viz_def) {
      this.visual_def = this.$store.state.viz_def;
    } else if (!this.$store.state.viz_def) {
      this.visual_def = this.algo.visualisations[0];
    }
    this.$emit('set_viz_def', this.visual_def);
  },
  methods: {
    set_viz_def(viz_def: VisualisationDefinition | null, i: number) {
      this.$store.commit(MUTATIONS.set_viz_def, viz_def);
      this.$emit('set_viz_def', this.visual_def);
    },
  },
});
</script>