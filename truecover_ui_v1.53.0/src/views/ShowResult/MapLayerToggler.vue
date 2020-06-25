<template>
  <div id="toggler">
    <q-checkbox
      v-for="layer in layers"
      :key="layer.layer_id"
      :label="layer.layer_id"
      v-model="layer.visible"
      @input="toggle_layer(layer)"
      outline
    />
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import { layers_manager } from '@/lib/map/layers_manager';
import { map_support } from '@/lib/map/map_support';
import { VisualisationLayer } from '@/types';

export default Vue.extend({
  data() {
    return {
      layers: [] as VisualisationLayer[],
    };
  },
  mounted() {
    this.layers = layers_manager.get_all_layers();
  },
  methods: {
    toggle_layer(layer: VisualisationLayer) {
      if (!map_support.mapbox_cache || !layer) {
        return;
      }

      const visibility = map_support.mapbox_cache.getLayoutProperty(
        layer.layer_id,
        'visibility',
      );
      if (!layer.visible) {
        map_support.mapbox_cache.setLayoutProperty(
          layer.layer_id,
          'visibility',
          'none',
        );
      } else {
        map_support.mapbox_cache.setLayoutProperty(
          layer.layer_id,
          'visibility',
          'visible',
        );
      }

      layer.visible = visibility !== 'visible';
    },
  },
});
</script>

<style scoped>
#toggler {
  background:rgba(10,10,10,0.35);
  border-radius: 5px;
  padding: 0.5%;
  position: absolute;
  z-index: 1;
  top: 10px;
  left: 10px;
}
</style>
