// ABOUTME: Implements Jenks natural breaks classification algorithm
// ABOUTME: Used for optimal choropleth map class breaks

/**
 * Calculate Jenks natural breaks classification
 * This algorithm finds class breaks that minimize variance within classes
 * and maximize variance between classes
 */
export function calculateJenksBreaks(data: number[], numClasses: number): number[] {
  if (data.length === 0) return [];
  if (numClasses >= data.length) return [...data].sort((a, b) => a - b);

  // Sort data
  const sortedData = [...data].sort((a, b) => a - b);
  const n = sortedData.length;

  // Initialize matrices
  const mat1 = Array(n + 1).fill(null).map(() => Array(numClasses + 1).fill(0));
  const mat2 = Array(n + 1).fill(null).map(() => Array(numClasses + 1).fill(0));

  // Initialize first row and column
  for (let i = 1; i <= numClasses; i++) {
    mat1[1][i] = 1;
    mat2[1][i] = 0;
    for (let j = 2; j <= n; j++) {
      mat2[j][i] = Infinity;
    }
  }

  // Calculate variance
  for (let l = 2; l <= n; l++) {
    let s1 = 0;
    let s2 = 0;
    let w = 0;

    for (let m = 1; m <= l; m++) {
      const i3 = l - m + 1;
      const val = sortedData[i3 - 1];

      s2 += val * val;
      s1 += val;
      w += 1;

      const v = s2 - (s1 * s1) / w;
      const i4 = i3 - 1;

      if (i4 !== 0) {
        for (let j = 2; j <= numClasses; j++) {
          if (mat2[l][j] >= (v + mat2[i4][j - 1])) {
            mat1[l][j] = i3;
            mat2[l][j] = v + mat2[i4][j - 1];
          }
        }
      }
    }

    mat1[l][1] = 1;
    mat2[l][1] = v;
  }

  // Extract breaks
  const breaks: number[] = [];
  let k = n;

  for (let j = numClasses; j >= 2; j--) {
    const id = mat1[k][j] - 1;
    breaks.push(sortedData[id]);
    k = mat1[k][j] - 1;
  }

  // Add min value at the beginning
  breaks.unshift(sortedData[0]);

  // Reverse to get ascending order
  breaks.reverse();

  return breaks;
}

/**
 * Create a Mapbox color expression using Jenks breaks
 */
export function createJenksColorExpression(
  values: number[],
  numClasses: number,
  colors: string[],
  propertyName: string = 'prevalence_prediction'
): any {
  if (colors.length !== numClasses) {
    throw new Error(`Number of colors (${colors.length}) must match number of classes (${numClasses})`);
  }

  const breaks = calculateJenksBreaks(values, numClasses);

  // Build a step expression for Mapbox
  // Format: ['step', ['get', 'property'], color0, break1, color1, break2, color2, ...]
  const expression: any[] = [
    'step',
    ['number', ['coalesce', ['get', propertyName], (breaks[0] + breaks[breaks.length - 1]) / 2]]
  ];

  // Add first color (for values below first break)
  expression.push(colors[0]);

  // Add breaks and corresponding colors
  for (let i = 1; i < breaks.length && i < colors.length; i++) {
    expression.push(breaks[i]);
    expression.push(colors[i]);
  }

  return expression;
}
