<template>
  <div>
    <StepNumber>
      <template v-slot:number>4</template>
      Configure result
    </StepNumber>

    <div v-if="!result">Waiting for result</div>
    <div v-else-if="!result_config">
      <VisSelector @set_viz_def="set_viz_def" />

      <p class="q-mb-xs text-weight-medium">Aggregation Options:</p>

      <div
        class="q-pa-sm"
        v-if="local_viz_def && local_viz_def.modes.aggregation"
      >
        <q-option-group
          v-model="aggregate_by"
          :options="aggregation_options"
          color="primary"
          inline
          dense
        />
      </div>
      <div v-else>No aggregation possible</div>

      <div v-if="aggregate_by === 'hexgrids'" class="q-pa-sm">
        <q-input
          label="Hex grid size (km)"
          v-model.number="local_grid_size_km"
          debounce="500"
          @input="update_grid_size_km"
          type="number"
          :rules="[
            val => val > 0 || 'Must be above 0',
            val => val < 20 || 'Must be less than 20',
          ]"
        />
      </div>

      <!-- Configure Params, incl with fn-specific form -->
      <div class="q-pa-sm">
        <LoadFile
          v-if="aggregate_by === 'districts'"
          :incoming_geodata="incoming_geodata"
          @set_incoming_geodata_and_filename="set_incoming_geodata_and_filename"
        />
      </div>
      <q-btn
        label="Visualise result"
        no-caps
        unelevated
        color="primary"
        @click="set_result_config"
        :disable="!local_viz_def"
      />
    </div>
    <div v-else>
      <pre>{{ preview }}</pre>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import mixins from 'vue-typed-mixins';
import { FeatureCollection } from '@turf/helpers';
import deepFreeze from '@ef-carbon/deep-freeze';

import VisSelector from '@/views/ShowResult/VisSelector.vue';
import { app_data } from '@/lib/mixins/app_data.mixin';
import { MUTATIONS, RootState } from '../store';
import { ResultConfig, VisualisationDefinition, AggregateBy } from '../types';
import { algos } from '../config/algos';
import config from '@/config/config';
import { mapState } from 'vuex';
import LoadFile from '@/views/ConfigureRun/LoadFile.vue';
import StepNumber from '@/views/StepNumber.vue';

export default mixins(app_data).extend({
  components: { VisSelector, LoadFile, StepNumber },
  data() {
    return {
      aggregate_by: AggregateBy.NONE,
      aggregation_options: [
        {
          label: 'No aggregation',
          value: AggregateBy.NONE,
        },
        {
          label: 'Aggregate on Hexgrids',
          value: AggregateBy.HEXGRIDS,
        },
        {
          label: 'Aggregate on Districts',
          value: AggregateBy.DISTRICTS,
        },
      ],
      local_grid_size_km: config.map.grid_size_km,
      local_viz_def: null as null | VisualisationDefinition,
      local_aggregate_on_hexgrids: true,
      incoming_geodata: null as null | FeatureCollection,
    };
  },
  computed: {
    preview(): string {
      const preview = {
        visualisation: `<${this.result_config.viz_def.id}>`,
        aggregate_by: this.aggregate_by,
        grid_size_km: this.result_config.grid_size_km,
      };
      return JSON.stringify(preview, null, 2);
    },
  },
  created() {
    // Mostly for debugging
    if (this.result_config) {
      this.local_grid_size_km = this.result_config.grid_size_km;
      this.local_viz_def = this.result_config.viz_def;
      this.local_aggregate_on_hexgrids =
        this.result_config.aggregate_by === 'hexgrids';
    }
  },
  methods: {
    set_viz_def(viz_def: VisualisationDefinition | null) {
      this.local_viz_def = viz_def;
    },
    set_result_config() {
      if (!this.local_viz_def) {
        console.error('Missing viz_def');
        return;
      }
      const result_config: ResultConfig = {
        viz_def: this.local_viz_def,
        aggregate_by: this.aggregate_by,
        grid_size_km: this.local_grid_size_km,
      };
      this.$store.commit(MUTATIONS.set_result_config, result_config);
      this.local_viz_def = null;
    },
    update_grid_size_km(grid_size_km: number) {
      this.$store.commit(MUTATIONS.set_grid_size_km, grid_size_km);
    },
    set_incoming_geodata_and_filename(
      geodata: FeatureCollection,
      filename: string,
    ) {
      this.incoming_geodata = deepFreeze(geodata);
      this.loaded_filename = filename;
      this.$store.commit(MUTATIONS.set_bin_polygons, this.incoming_geodata);
    },
  },
});
</script>
