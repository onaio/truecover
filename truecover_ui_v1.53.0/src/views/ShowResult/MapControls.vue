<template>
  <div>
    <p class="q-mb-xs text-weight-medium">Layer options</p>
    <q-radio
      v-for="(layer, i) in config.map.baselayer_styles"
      :key="`a${i}`"
      @input="set_baselayer(layer)"
      :label="layer.name"
      :val="layer"
      v-model="local_base_layer"
    />
  </div>
</template>

<script lang='ts'>
import Vue from 'vue';
import mixins from 'vue-typed-mixins';
import { mapState } from 'vuex';

import config from '@/config/config';
import { BaseLayer } from '@/types';
import { map_support } from '@/lib/map/map_support';
import { app_data } from '@/lib/mixins/app_data.mixin';
import VisSelector from '@/views/ShowResult/VisSelector.vue';
import { MUTATIONS } from '@/store';



export default mixins(app_data).extend({
  components: { VisSelector },
  data() {
    return {
      // helpers
      config,
      local_base_layer: null,
    };
  },
  mounted() {
    this.local_base_layer = this.base_layer;
  },
  methods: {
    set_baselayer(baselayer: null | BaseLayer) {
      this.$emit('change', this.local_base_layer);
      this.$store.commit(MUTATIONS.set_baselayer, this.local_base_layer);
    },
  },
});
</script>

