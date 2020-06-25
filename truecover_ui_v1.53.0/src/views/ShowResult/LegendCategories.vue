<template>
  <div>
    <div v-if='colours' class="row" >
      <div v-for="{colour, value} in colours" :key="colour" class="column col">
        <div class="row" :style="style_category(colour)" style='height: 20px;'></div>
        <div class="row" style='height: 20px;'>
          <span class='bin-value'>{{format_value(value)}}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import mixins from 'vue-typed-mixins';

import { AttributeType, ColourMapping } from '@/types';
import { AttributionControl } from 'mapbox-gl';
import chroma from 'chroma-js';
import config from '@/config/config';
import { legend } from '@/lib/mixins/legend.mixin';

export default mixins(legend).extend({
  computed: {
    colours(): null | ColourMapping[] {
      return this.viz.meta.colour_mapping;
    },
  },
  methods: {
    style_category(colour: string) {
      return `background-color: ${colour};`;
    },
    format_value(value: any): string {
      if (typeof value === 'number') {
        return value.toFixed(config.display.defaults.numeric_precision);
      } else {
        return `${value}`;
      }
    },
  },
});
</script>

<style scoped>
.legend-box {
  height: 20px;
  float: left;
}
.bin-value {
  padding-left: 5px;
}
</style>
