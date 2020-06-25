<template>
  <div>
    <div v-if="result && !mapbox_loading_problem && !too_many_features">
      <div id="map">
        <MapLayerToggler v-if='map_loaded'/>
      </div>

      <MapControls @change="change_base_layer" />
      <MapDecorations v-if="viz_layer" :viz="viz_layer" />
    </div>

    <div
      v-else-if="too_many_features"
    >Too many features to map ({{ result_features_count_or_zero }})</div>
    <div v-else-if="mapbox_loading_problem">
      Problem loading map - check network, or could be problem with aggregation
      data
    </div>
    <div v-else>Some other problem trying to draw map</div>
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import mixins from 'vue-typed-mixins';
import { get } from 'lodash';

import config from '@/config/config';
import { map_support } from '@/lib/map/map_support.ts';

import MapDecorations from '@/views/ShowResult/MapDecorations.vue';
import MapControls from '@/views/ShowResult/MapControls.vue';
import { app_data } from '@/lib/mixins/app_data.mixin';
import { BaseLayer, VisualisationLayer, VisualisationMode } from '@/types';
import { feature } from '@turf/helpers';
import { Popup } from 'mapbox-gl';
import { layers_manager } from '@/lib/map/layers_manager';
import MapLayerToggler from '@/views/ShowResult/MapLayerToggler.vue';

export default mixins(app_data).extend({
  components: { MapDecorations, MapControls, MapLayerToggler },
  data() {
    return {
      map_loaded: false,
      mapbox_loading_problem: false,
      viz_layer: null as VisualisationLayer | null,
    };
  },
  computed: {
    too_many_features(): boolean {
      if (!this.result.result) {
        return false;
      }
      return this.result.result.features.length > config.map.max_features;
    },
  },
  mounted() {
    this.draw_map();
  },
  destroyed() {
    map_support.remove_map();
  },
  methods: {
    async draw_map(): Promise<void> {
      try {
        // Resolves on the Mapbox 'load' event
        const base_layer = this.base_layer
          ? this.base_layer
          : config.map.baselayer_styles[0];

        const map = await map_support.draw_map(
          base_layer,
          this.$store.state.bin_polygons,
        );
        if (!map) {
          throw new Error(
            'No map created in map_support.draw_map - definitely investigate',
          );
        }
        this.attachPopups(map);
        const layers = layers_manager
          .get_all_layers()
          .filter((l) => get(l, 'options.viz_mode') === VisualisationMode.target);
        this.viz_layer = layers[0] ? layers[0] : null;
        this.map_loaded = true;
      } catch (e) {
        console.error(e);
        this.mapbox_loading_problem = true;
      }
    },
    async change_base_layer(base_layer: BaseLayer) {
      const map = await map_support.draw_map(
        base_layer,
        this.$store.state.bin_polygons,
      );
      if (!map) {
        throw new Error(
          'No map created in map_support.draw_map - definitely investigate',
        );
      }
      this.attachPopups(map);
    },
    attachPopups(map: mapboxgl.Map) {
      map.on('click', (e) => {
        console.log('TODO: Check if click on visible layer');
        const map_feature = map.queryRenderedFeatures(e.point, {})[0];
        if (!map_feature || !map_feature.properties) {
          return;
        }
        const properties = map_feature.properties;
        const property_keys = Object.keys(map_feature.properties);
        const property_paragraphs = property_keys
          .map((p) => {
            return `<p>${p} : ${properties[p]}</p>`;
          })
          .join('');
        new Popup({ closeOnClick: true })
          .setLngLat(e.lngLat)
          .setHTML(`${property_paragraphs}`)
          .addTo(map);
      });
    },
  },
});
</script>

<style scoped>
#map {
  width: 100%;
  min-height: 400px;
  margin: 0px;
}
</style>
