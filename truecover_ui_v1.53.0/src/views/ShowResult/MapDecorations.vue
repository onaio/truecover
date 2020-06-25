<template>
  <div class="legend-container">
    <div v-if="layer">
      <div v-if="viz_mode === VisualisationMode.target ">
        <strong>Targets</strong>
        {{viz_def.title}}
        <span
          v-if="viz_def.modes.target.measure"
        >({{viz_def.modes.target.measure}})</span>
        <span v-if="viz_def.modes.aggregation && viz_def.modes.aggregation.measure" > (Aggregated by {{viz_def.modes.aggregation.measure}})</span>
      </div>
      <LegendCategories :viz="viz" />
    </div>
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import mixins from 'vue-typed-mixins';
import { Layer } from 'mapbox-gl';

import { AttributeType, VisualisationMode } from '@/types';
import LegendCategories from '@/views/ShowResult/LegendCategories.vue';
import { legend } from '@/lib/mixins/legend.mixin';

export default mixins(legend).extend({
  components: { LegendCategories },
  data() {
    return {
      AttributeType,
      VisualisationMode,
    };
  },
});
</script>

<style scoped>
.legend-container {
  height: 100%;
  padding: 5px;
}
</style>