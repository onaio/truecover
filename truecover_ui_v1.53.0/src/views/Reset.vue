<template>
  <div class='q-pb-sm float-right'>
    <q-btn label="Reset" flat size='sm' color="primary" @click="confirm=true" />
    <q-dialog v-model="confirm">
      <q-card>
        <q-card-section class="row items-center">
          <span class="q-ml-sm">Reset - lose all data, parameters and visualisations?</span>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" color="primary" v-close-popup />
          <q-btn flat label="Reset" color="negative" v-close-popup @click='reset_everything'/>
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script lang='ts'>
import Vue from 'vue';

export default Vue.extend({
  data() {
    return {
      confirm: false,
    };
  },
  methods: {
    reset_everything() {
      location.reload();
    },
  },
});
</script>