<template>
  <div>
    <div v-if="incoming_geodata">
      File loaded:
      {{loaded_filename}}
      (valid GeoJSON, {{features_count}} features)
    </div>

    <div v-else>
      <div v-if="load_messages">
        <em>Loading file failed:</em>
        {{load_messages.join(', ')}}
        <p>Try again</p>
      </div>
      <div v-else>Select a file to load some geodata</div>
      <input @change="change" ref="file_selector" type="file" />
    </div>
  </div>
</template>

<script lang='ts'>
import Vue from 'vue';
import { FeatureCollection } from 'geojson';

import { load_data_from_file } from '@/lib/data/load_file';

export default Vue.extend({
  props: {
    incoming_geodata: Object,
  },
  data() {
    return {
      load_messages: null as null | string[],
      loaded_filename: null as null | string,
    };
  },
  computed: {
    features_count(): number {
      if (!this.incoming_geodata) {
        return 0;
      }
      return this.incoming_geodata.features.length;
    },
  },
  methods: {
    async change(event: Event) {
      const files = (event.target as HTMLInputElement).files;
      const file = files ? files[0] : null;

      if (!file) {
        this.load_messages = ['Missing file - was it deleted?'];
        return;
      }

      const result = await load_data_from_file(file);
      if (result.messages) {
        this.load_messages = result.messages;
      } else {
        this.loaded_filename = file.name;
        this.$emit(
          'set_incoming_geodata_and_filename',
          result.geodata,
          this.loaded_filename,
        );
      }
    },
  },
});
</script>
