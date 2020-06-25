import geojsonhint from '@mapbox/geojsonhint';
import { ParseResult, GeoJSONHintError } from '@/types';
import { filter_messages } from '@/lib/data/check_if_geojson';

async function load_data_from_file(file: File): Promise<ParseResult> {
  const file_content: undefined | {} = await read_file(file);

  if (!file_content) {
    return {
      messages: ['No content from file'],
      geodata: null,
    };
  }

  try {
    return await parse_raw_data(file.name, file_content);
  } catch (e) {
    console.error(e);
    return {
      messages: ['Could not load data from file'],
      geodata: null,
    };
  }
}

function read_file(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject();
    }
    const reader = new FileReader();
    reader.addEventListener('load', (event) => {
      const read_result = reader.result as string;
      return resolve(read_result);
    });
    reader.readAsBinaryString(file as Blob);
  });
}

function parse_raw_data(filename: string, raw_data: any): ParseResult {
  let geodata: any;

  let errors: GeoJSONHintError[];
  let messages: string[] = [];
  const ext = filename.split('.').slice(-1)[0] || '';

  if (!['json', 'geojson'].includes(ext)) {
    const msg = 'Cannot load from file with extension ' + ext;
    return {
      messages: [msg],
      geodata: null,
    };
  }

  try {
    geodata = JSON.parse(raw_data);
    errors = geojsonhint.hint(geodata, { noDuplicateMembers: true });
  } catch (e) {
    console.error(e);
    const msg = 'Problem parsing JSON';
    return {
      messages: [msg],
      geodata: null,
    };
  }

  if (geodata.features.length === 0) {
    const msg = 'Zero Features found in file';
    return {
      messages: [msg],
      geodata: null,
    };
  }

  messages = filter_messages(errors);

  if (messages.length > 0) {
    return {
      messages: ['Not valid GeoJSON', ...messages],
      geodata: null,
    };
  }

  return {
    messages: null, // Only case in which you have valid GeoJSON
    geodata,
  };
}

export { load_data_from_file };
