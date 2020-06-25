<template>
  <div>
    <p class="q-mb-xs text-weight-medium" >Download options</p>
    <div class="q-gutter-sm row">
      <q-btn
        label="Download GeoJSON"
        no-caps
        outline
        color='primary'
        size="small"
        @click="download_json"
      />
      <q-btn
        label="Download CSV"
        no-caps
        outline
        color='primary'
        size="small"
        @click="download_csv"
      />
    </div>
  </div>
</template>

<script lang='ts'>
import mixins from 'vue-typed-mixins';
import download from 'downloadjs';
import Papa from 'papaparse';
import dayjs from 'dayjs';

import { app_data } from '@/lib/mixins/app_data.mixin';
import { geodata_carrier } from '@/lib/data/geodata_carrier';
import { feature_properties } from '@/lib/help';
import { FeatureCollection } from '@turf/helpers';

export default mixins(app_data).extend({
  methods: {
    download_json() {
      const geodata_to_download = this.geodata_to_download();
      const content = JSON.stringify(geodata_to_download);
      const filename = this.filename('json');
      download(content, filename);
    },
    download_csv() {
      const geodata_to_download = this.geodata_to_download();
      if (!geodata_to_download) {
        console.error('Nothing to download');
        return;
      }

      const json_content = feature_properties(geodata_to_download);
      if (json_content.length === 0) {
        return;
      }
      const csv_content = Papa.unparse(json_content as any[]);
      const filename = this.filename('csv');
      download(csv_content, filename);
    },
    filename(type: 'json' | 'csv'): string {
      const timestamp = dayjs(this.result.finished_at).format('YYYYMMDD-HHmm');
      const algo_fn_name = this.algo.fn_name;
      return `${timestamp}-${algo_fn_name}.${type}`;
    },
    geodata_to_download(): null | FeatureCollection {
      const geodata = this.result.result;
      if (geodata === undefined || geodata === null || geodata.length === 0) {
        return null;
      }

      const geodata_to_download = geodata_carrier.for_download();
      if (!geodata_to_download) {
        return null;
      }
      return geodata;
    },
  },
});
</script>

<style scoped>

</style>