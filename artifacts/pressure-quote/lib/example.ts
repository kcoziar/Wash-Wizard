import { defaultSettings, sampleDraft } from './defaults';
import { draftFromRequest, parseRequest } from './parser';
import type { Draft, Settings } from './types';

/** A made-up customer message. Every name, number and size in it is fictional. */
export const EXAMPLE_MESSAGE =
  "Hi! This is Dana Whitfield at 418 Cedar Ridge Ln. Could you give me a price to pressure wash our driveway (about 24 x 36) and the front walkway, maybe 40 ft long and 4 ft wide? Also the 6 porch steps. We were hoping to stay around $300. Thanks! 555-201-7788";

/** Rates that belong to the example only. They are never written to the operator's settings. */
const EXAMPLE_RATES = { driveway: '0.18', walkway: '0.25', stairs: '8' } as const;

/**
 * The example message turned into a complete, editable quote: the real parser reads it, then sample
 * rates price it. The caller saves it as a sample job, so it never uses a free quote, never appears
 * as an earlier customer and never feeds time suggestions.
 */
export function exampleDraft(settings: Settings): Draft {
  // Imperial on purpose: the message is in feet, and the sample rates are per square foot.
  const base = defaultSettings();
  const priced: Settings = {
    ...base,
    terms: settings.terms,
    customerNote: settings.customerNote,
    validDays: settings.validDays,
    rates: {
      ...base.rates,
      driveway: { ...base.rates.driveway, rate: EXAMPLE_RATES.driveway },
      walkway: { ...base.rates.walkway, rate: EXAMPLE_RATES.walkway },
      stairs: { ...base.rates.stairs, rate: EXAMPLE_RATES.stairs },
    },
  };
  const parsed = parseRequest(EXAMPLE_MESSAGE, { units: 'imperial', mode: 'customer' });
  const draft = draftFromRequest(parsed, priced);
  const sample = sampleDraft(settings);
  draft.lines = draft.lines.map((l) => ({ ...l, rateSource: l.rate ? 'sample' : l.rateSource }));
  draft.pricing = sample.pricing;
  draft.visit = sample.visit;
  draft.costs = sample.costs;
  draft.ownerTarget = sample.ownerTarget;
  return draft;
}

export function isExampleJob(job: { sample: boolean; request: { text: string } | null }): boolean {
  return job.sample && job.request?.text === EXAMPLE_MESSAGE;
}
