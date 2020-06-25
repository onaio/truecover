<script lang="ts">
import { LayerName } from '@/types';

const layer_names: LayerName[] = [
  { id: '0', value: 'elev_m', label: 'Elevation' },
  { id: '1', value: 'dist_to_water_m', label: 'Distance to water' },
  { id: '2', value: 'dist_to_road_m', label: 'Distance to road' },
  { id: '3', value: 'bioclim1', label: 'Annual Mean Temperature' },
  { id: '4', value: 'bioclim2', label: 'Mean Diurnal Range (Mean of monthly (max temp - min temp))' },
  { id: '5', value: 'bioclim3', label: 'Isothermality (BIO2/BIO7) (* 100)' },
  { id: '6', value: 'bioclim4', label: 'Temperature Seasonality (standard deviation *100)' },
  { id: '7', value: 'bioclim5', label: 'Max Temperature of Warmest Month' },
  { id: '8', value: 'bioclim6', label: 'Min Temperature of Coldest Month' },
  { id: '9', value: 'bioclim7', label: 'Temperature Annual Range (BIO5-BIO6)' },
  { id: '10', value: 'bioclim8', label: 'Mean Temperature of Wettest Quarter' },
  { id: '11', value: 'bioclim9', label: 'Mean Temperature of Driest Quarter' },
  { id: '12', value: 'bioclim10', label: 'Mean Temperature of Warmest Quarter' },
  { id: '13', value: 'bioclim11', label: 'Mean Temperature of Coldest Quarter' },
  { id: '14', value: 'bioclim12', label: 'Annual Precipitation' },
  { id: '15', value: 'bioclim13', label: 'Precipitation of Wettest Month' },
  { id: '16', value: 'bioclim14', label: 'Precipitation of Driest Month' },
  { id: '17', value: 'bioclim15', label: 'Precipitation Seasonality (Coefficient of Variation)' },
  { id: '18', value: 'bioclim16', label: 'Precipitation of Wettest Quarter' },
  { id: '19', value: 'bioclim17', label: 'Precipitation of Driest Quarter' },
  { id: '20', value: 'bioclim18', label: 'Precipitation of Warmest Quarter' },
  { id: '21', value: 'bioclim19', label: ' Precipitation of Coldest Quarter' },
];

export default layer_names;



</script>