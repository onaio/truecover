<template>
  <div>
    <div v-if="table_data">
      <vue-virtual-table
        :height="$parent.$el.clientHeight"
        :config="table_data.config"
        :data="table_data.data"
      ></vue-virtual-table>
    </div>
    <div
      v-else-if="exceeds_feature_limit"
    >Too many features to display ({{geodata_features_count_or_zero}})</div>
    <div v-else>Result not suitable for table</div>
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import { mapState } from 'vuex';
import mixins from 'vue-typed-mixins';
import { isEmpty, isArray } from 'lodash';
import { Feature, GeoJsonProperties } from 'geojson';
import VueVirtualTable from 'vue-virtual-table';

import config from '@/config/config';
import { feature_properties } from '@/lib/help';
import { app_data } from '@/lib/mixins/app_data.mixin';
import { remove_internal_id_from_geodata, check_has_poly } from '@/lib/data/poly_to_point.ts';

interface Column {
  prop: string;
  name: string;
}

interface TableData {
  data: any[];
  config: Column[];
}

export default mixins(app_data).extend({
  components: { VueVirtualTable },
  data() {
    return {
      exceeds_feature_limit: null as null | boolean,
      table_data: null as null | TableData,
    };
  },
  mounted() {
    this.set_table_data();
  },
  methods: {
    set_table_data(): void {
      this.exceeds_feature_limit = false;
      this.table_data = null;

      const geodata = this.result.result;

      if (!geodata) {
        return;
      }

      if (geodata.features.length <= 0) {
        return;
      } else if (geodata.features.length > config.table.max_features) {
        this.exceeds_feature_limit = true;
        return;
      }

      if (check_has_poly(geodata)) {
        remove_internal_id_from_geodata(geodata);
      }

      const data = feature_properties(geodata);

      if (data.length === 0) {
        return;
      }

      if (data.length > config.table.max_features) {
        this.exceeds_feature_limit = true;
        return;
      }

      const first_row = data[0];

      if (!first_row) {
        return;
      }

      const table_config = Object.keys(first_row).map((d) => {
        return {
          prop: d,
          name: d,
        };
      });

      const table_data = {
        data,
        config: table_config,
      };

      this.table_data = table_data;
    },
  },
});
</script>
