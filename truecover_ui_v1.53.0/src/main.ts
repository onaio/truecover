import Vue from 'vue';
import '@/quasar';
import '../node_modules/material-design-icons/iconfont/material-icons.css';

// Launch
import { set_api_key } from '@/lib/api_key';
set_api_key();

import App from '@/App.vue';
import store from '@/store';
import { load_fake } from './lib/load_fake';

// load_fake();

Vue.config.productionTip = false;

new Vue({
  store,
  render: (h) => h(App),
}).$mount('#app');
