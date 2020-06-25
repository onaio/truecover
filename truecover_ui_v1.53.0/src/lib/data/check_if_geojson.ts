import geojsonhint from '@mapbox/geojsonhint';
import { GeoJSONHintError } from '@/types';
import config from '@/config/config';

// TODO: DRY this up compared with `load_file.ts`
export function get_messages(json: any): string[] {
  let errors: GeoJSONHintError[];

  try {
    errors = geojsonhint.hint(json, {noDuplicateMembers: true});
  } catch (error) {
    console.error(error);
    return ['Error parsing JSON or checking for validity'];
  }

  return filter_messages(errors);
}

// Ignore some geojsonhint rules
export function filter_messages(errors: GeoJSONHintError[]): string[] {
  // Collect just the messages. GeoJSONHint also gives us line-numbers
  // in some circumstances, but not the way we're using it.
  const messages = errors.map((error: GeoJSONHintError) => error.message);

  const ignored_geojsonhint_rules = config.loading.ignored_geojsonhint_rules;

  return [...new Set(messages.filter((message) => {
    // Return false if it's in the ignored_geojsonhint_rules
    return !ignored_geojsonhint_rules.some((rule) => {
      return message.startsWith(rule);
    });
  }))];
}

export function check_if_geojson(json: any): boolean {
  const filtered_messages = get_messages(json);

  if (filtered_messages.length === 0) {
    return true;
  }

  return false;
}
