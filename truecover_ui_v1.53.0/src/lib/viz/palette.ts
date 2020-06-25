import { Expression } from 'mapbox-gl';
import { ColourMapping } from '@/types';

export function interpolate_colour_def(
  min: number,
  max: number,
  palette: string[],
  attribute_field: string,
): Expression {
  const colour_def: Expression = [
    'interpolate', ['linear'],
    ['get', attribute_field],
    min, palette[0],
    max, palette.slice(-1)[0],
  ];
  return colour_def;
}

export function match_colour_def(
  palette: Array<string | number>,
  attribute_field: string,
): Expression | string {
  const fallback = palette.slice(-1)[0];
  const exp = [
    'match',
    ['get', attribute_field],
    ...palette,
    fallback,
  ];
  return exp as Expression;
}

export function boolean_colour_def(
  palette: ColourMapping[],
  attribute_field: string,
): Expression | string {
  const colour_def: Expression = [
    'case',
    ['get', attribute_field], palette[0].colour,
    ['!', ['get', attribute_field]], palette.slice(-1)[0].colour,
    palette.slice(-1)[0].colour,
  ];
  return colour_def;
}

export function step_colour_def(
  colour_mapping: ColourMapping[],
  attribute_field: string,
): Expression | string {
  const flat_palette = colour_mapping.reduce((acc: any[], line, i) => {
    if (i === 0) {
      acc.push(line.colour);
      return acc;
    } else {
      acc.push(line.value);
      acc.push(line.colour);
      return acc;
    }
  }, []);

  const colour_def: Expression = [
    'step',
    ['get', attribute_field],
    ...flat_palette,
  ];

  return colour_def;
}
