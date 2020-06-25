import Vue from 'vue';
import { pickBy as pick_by, cloneDeep as clone_deep } from 'lodash';

export const params_mixin = Vue.extend({
  data() {
    return {
      default_params: {}, // Only thing the consumer of mixin needs to set
      specific_params: {} as any,
    };
  },
  watch: {
    specific_params: {
      deep: true,
      handler() { this.emit_params(); },
    },
  },
  created() {
    this.reset_params();
  },
  methods: {
    reset_params() {
      this.specific_params = clone_deep(this.default_params);
    },
    /**
     * Can override this in component, to change structure/shape of
     * params that are emitted
     *
     * @returns {*}
     */
    process_params(): any {
      return this.specific_params;
    },
    emit_params() {
      const emit_this = pick_by(this.process_params()); // Keep only properties that are not null
      this.$emit('set_local_params', emit_this);
    },
  },
});
