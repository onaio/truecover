import { isNumber, zip } from 'lodash';
import {
  LayerRequestOptions,
  AttributeType,
  VisualisationLayerMetadata,
  ColourMapping,
} from '@/types';
import config from '@/config/config';
import { boolean_colour_def, step_colour_def } from '@/lib/viz/palette';
import chroma from 'chroma-js';
import { Expression } from 'mapbox-gl';
import { FeatureCollection } from '@turf/helpers';


/**
 * Generate the palette, scales, etc.
 *
 * @export
 * @param {LayerRequestOptions} options
 * @param {FeatureCollection} geodata
 * @returns {VisualisationLayerMetadata}
 */
export function create_viz_meta(
  options: LayerRequestOptions,
  geodata: FeatureCollection,
): VisualisationLayerMetadata {
  let palette: Expression | string[];
  let palette_colours: string[];
  let values: any[];
  let colour_mapping: ColourMapping[];

  const viz_meta: VisualisationLayerMetadata = {
    colour_expression: config.map.defaults.point_colour,
    colour_mapping: [],
  };

  // Without any attribute to work with, all we can do is return the default colour
  if (options.viz_def.attribute === undefined) {
    viz_meta.colour_expression = config.map.defaults.point_colour;
    return viz_meta;
  }

  // Attribute field is given, can do things with it
  // Extract for shorter variable
  const attribute_field = options.viz_def.attribute.field;

  // Figure colour scheme from attribute_type
  switch (options.viz_def.attribute.type) {
    case AttributeType.boolean:
      // 2-colour bins
      values = [true, false];
      palette = options.viz_def.palette;
      palette_colours = chroma.scale(palette).colors(2);
      colour_mapping = colour_mapping_from_values_and_colours(values, palette_colours);
      viz_meta.colour_expression = boolean_colour_def(colour_mapping as ColourMapping[], attribute_field);
      viz_meta.colour_mapping = colour_mapping;
      break;
    case AttributeType.continuous:
      // Handle as binned/categorical for now
      if (!attribute_field) {
        viz_meta.colour_expression = config.map.defaults.point_colour;
        break;
      }

      const raw_values = geodata.features.map((i) => {
        if (!i.properties) {
          return;
        }
        return i.properties[attribute_field];
      }).filter((i) => {
        return isNumber(i);
      });

      // Use default number of bins
      values = chroma.limits(raw_values, 'e', config.display.defaults.bin_count);
      const uniq_values = [...new Set(values)];
      if (uniq_values.length === 1) {
        const colour = 'red';
        console.error('Single value for all');
        viz_meta.colour_expression = colour;
        viz_meta.colour_mapping = [{ value: uniq_values[0], colour }];
        break;
      }

      palette = options.viz_def.palette;
      palette_colours = chroma.scale(palette).colors(config.display.defaults.bin_count);
      colour_mapping = colour_mapping_from_values_and_colours(values, palette_colours);
      const interim = step_colour_def(colour_mapping, attribute_field);
      viz_meta.colour_expression = interim;
      viz_meta.colour_mapping = colour_mapping;
      break;
    case AttributeType.category:
      // Multi-colour bins
      console.error('TODO: bins for category type');
      viz_meta.colour_expression = 'fuschia';
      break;
    default:
      viz_meta.colour_expression = config.map.defaults.point_colour;
      break;
  }
  return viz_meta;
}

function colour_mapping_from_values_and_colours(values: any[], palette_colours: string[]): ColourMapping[] {
  const zipped = zip(values, palette_colours);
  const colour_mapping_with_gaps = zipped.map((i) => {
    const value = i[0];
    const colour = i[1];
    if (typeof value !== 'undefined' && typeof colour !== 'undefined') {
      return {
        value,
        colour,
      };
    }
  });
  const colour_mapping = colour_mapping_with_gaps.filter((i) => i);
  return colour_mapping as ColourMapping[];
}
