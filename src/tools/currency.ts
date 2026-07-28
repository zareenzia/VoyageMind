/**
 * Currency conversion. Deliberately NOT done by an agent.
 *
 * A model asked to convert GBP to USD will produce a number that looks right and
 * is silently months out of date. That error then propagates into every budget
 * check downstream with no way to detect it.
 *
 * TODO: replace STATIC_RATES with a live rates API (exchangerate.host, Open Exchange
 * Rates, or your bank's feed) behind the same interface. Cache daily — FX rates do
 * not need to be fetched per request.
 */

export class UnknownCurrencyError extends Error {
  constructor(readonly currency: string) {
    super(`No exchange rate available for ${currency}`);
    this.name = "UnknownCurrencyError";
  }
}

/** Units of the given currency per 1 USD. Placeholder values — do not ship these. */
const STATIC_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 157,
  BDT: 122,
  INR: 84,
  AUD: 1.52,
  CAD: 1.37,
  SGD: 1.34,
  THB: 34.5,
};

export interface ConversionResult {
  usd: number;
  rate: number;
  /** True while STATIC_RATES is in use. Surface this in output — users deserve to know. */
  stale: boolean;
}

export function convertToUsd(amount: number, currency: string): ConversionResult {
  const code = currency.toUpperCase();
  const rate = STATIC_RATES[code];
  if (rate === undefined) throw new UnknownCurrencyError(code);
  return {
    usd: Math.round((amount / rate) * 100) / 100,
    rate,
    stale: true,
  };
}

/**
 * Budget in USD, or null if none was given. Returns null rather than throwing on an
 * unknown currency so a missing rate degrades to "no budget constraint" instead of
 * killing the pipeline — the Critic reports it as a soft note.
 */
export function budgetInUsd(
  amount: number | null,
  currency: string | null,
): number | null {
  if (amount === null || currency === null) return null;
  try {
    return convertToUsd(amount, currency).usd;
  } catch {
    return null;
  }
}
