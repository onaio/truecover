declare module '@turf/center' {
  import { Feature, Point, Properties } from '@turf/helpers';
  export default function center(geojson: any): Feature<Point, Properties>;
}

declare module '@turf/centroid' {
  import { Feature, Point, Properties } from '@turf/helpers';
  export default function centroid(geojson: any): Feature<Point, Properties>;
}

declare module '@turf/hex-grid';
