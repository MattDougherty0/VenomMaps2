export const MAJOR_ISSUES_DEFAULT = new Set<string>([
  'COORDINATE_INVALID',
  'ZERO_COORDINATE',
  'COUNTRY_MISMATCH',
  'COUNTRY_COORDINATE_MISMATCH',
  'COORDINATE_OUT_OF_RANGE',
  'TAXON_MATCH_NONE',
  'BASIS_OF_RECORD_INVALID',
  'COORDINATE_UNCERTAINTY_METERS_TOO_LARGE'
]);

export const STRICT_CONFIG = {
  minYear: 2015,
  maxUncertaintyMeters: 2000,
  allowedBasis: new Set<string>(['HumanObservation','Observation','MachineObservation']),
  keepMonthApprox: true
};

export const PATHS = {
  vendorRoot: 'vendor/venommaps',
  vendorStates: 'vendor/us/us_states_simple.geojson',
  outRoot: 'data/out',
  webData: 'web/data'
};

export const FIELD_ALIASES: Record<string, string[]> = {
  decimalLatitude: ['decimalLatitude', 'latitude', 'lat'],
  decimalLongitude: ['decimalLongitude', 'longitude', 'lon'],
  eventDate: ['eventDate', 'date', 'observed_on', 'time_observed_at', 'observation_date', 'verbatimEventDate', 'verbatim_date'],
  year: ['year', 'yr'],
  month: ['month', 'mo'],
  day: ['day', 'dy'],
  // Prefer curated final species if present
  scientificName: ['scientificName', 'species', 'final_species', 'taxonomy_updated_species', 'database_recorded_species'],
  basisOfRecord: ['basisOfRecord', 'basis', 'recordType', 'type', 'observationType'],
  occurrenceStatus: ['occurrenceStatus'],
  coordinateUncertaintyInMeters: ['coordinateUncertaintyInMeters', 'uncertainty_m', 'positional_accuracy', 'accuracy', 'coord_uncertainty_m'],
  occurrenceRemarks: ['occurrenceRemarks', 'remarks', 'locality'],
  issues: ['issues', 'gbifIssues', 'issue'],
  occurrenceID: ['occurrenceID', 'id'],
  captive: ['captive', 'inCaptivity', 'establishmentMeans', 'captive_cultivated']
};

export const ACCEPTED_OCCURRENCE_EXTS = [
  '.csv', '.tsv', '.ndjson', '.geojson',
  '.csv.gz', '.tsv.gz', '.ndjson.gz', '.geojson.gz',
  '.xlsx'
];


