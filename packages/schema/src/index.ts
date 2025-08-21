import { z } from 'zod';

export const NormOccurrence = z.object({
  id: z.string(),
  source: z.string(),
  scientificName: z.string(),
  commonName: z.string().optional(),
  eventDate: z.string().optional(),
  eventYear: z.number().int().optional(),
  eventMonth: z.number().int().optional(),
  eventDay: z.number().int().optional(),
  dateConfidence: z.enum(['high','text_inferred_full','text_inferred_month','text_inferred_year','none']),
  basisOfRecord: z.string().optional(),
  isCaptive: z.boolean().default(false),
  decimalLatitude: z.number(),
  decimalLongitude: z.number(),
  coordinateUncertaintyInMeters: z.number().optional(),
  issues: z.array(z.string()).default([]),
  stateCode: z.string().optional(),
  inUS: z.boolean().default(false),
  // Enriched fields
  insideExpertRange: z.boolean().optional(),
  h3_r6: z.string().optional(),
  h3_r5: z.string().optional(),
});

export type NormOccurrence = z.infer<typeof NormOccurrence>;

export const StrictRecentItem = z.object({
  lat: z.number(),
  lon: z.number(),
  ts: z.number().int(),
  count: z.number().int().optional(),
  tsMeta: z.enum(['high','approx_month','approx_year']).optional()
});
export type StrictRecentItem = z.infer<typeof StrictRecentItem>;


