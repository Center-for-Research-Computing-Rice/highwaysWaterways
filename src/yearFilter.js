export const FIRST_YEAR_FIELD = 'firstyear';
export const LAST_YEAR_FIELD = 'lastyear';

/**
 * Builds a SQL `where` clause that keeps features whose
 * [firstyear, lastyear] range contains the given year.
 * Returns null when the year is not a finite number.
 */
export function buildYearWhere(year) {
  const parsed = Number.parseInt(String(year), 10);
  return Number.isFinite(parsed)
    ? `${FIRST_YEAR_FIELD} <= ${parsed} AND ${LAST_YEAR_FIELD} >= ${parsed}`
    : null;
}

/** True when the layer exposes both `firstyear` and `lastyear` fields. */
export function layerHasYearFields(layer) {
  const fields = layer.fields;
  if (!fields?.length) return false;
  const names = new Set(fields.map((field) => field.name));
  return names.has('firstyear') && names.has('lastyear');
}
