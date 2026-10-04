/**
 * Isle of Man Companies Registry deep links.
 *
 * The brief for this module was a lookup panel. It is deliberately
 * link-building only, not scraping, and the distinction is the whole point:
 *
 *   - Basic company information is public and free. No login.
 *   - Documents (annual returns, accounts, confirmation statements), officer
 *     details and charges are behind an account and payment.
 *   - robots.txt is served by an F5 WAF that rejects non-browser clients, so
 *     we cannot even establish crawl permissions.
 *
 * So we hand the user a link to the official search, pre-filled with their
 * query, and let the Registry do the rest. Nothing is copied, cached,
 * mirrored or republished, which keeps this squarely on the right side of both
 * the terms and the Copyright, Designs and Patents Act 1988 (section 47,
 * computer-generated copying of substantially the whole of a database).
 *
 * The parameter names below were read off the live search form, which is:
 *   <form action="companysearch.iom" method="get">
 *     <input type="radio" name="searchby" value="0">  name
 *     <input type="radio" name="searchby" value="1">  number
 *     <input type="text"  name="searchtext">
 */

export const COMPANIES_REGISTRY_SEARCH_URL =
  "https://services.gov.im/ded/services/companiesregistry/companysearch.iom";

/** The newer portal. Reachable, but a JS SPA with no crawlable profile URLs. */
export const CENTRAL_REGISTRY_URL = "https://centralregistry.gov.im/";

/** Separate regulator, separate registers. */
export const FSA_REGISTERS_URL = "https://www.iomfsa.im/registers/";

export const COMPANIES_REGISTRY_DOCUMENTS_URL =
  "https://services.gov.im/ded/services/companiesregistry/viewpurchaseddocuments.iom";

export type RegistrySearchMode = "name" | "number";

/**
 * An Isle of Man company number is 7 characters: 6 digits plus a suffix letter,
 * for example 005629V (Manx Telecom Trading Ltd) or 112233C.
 */
const COMPANY_NUMBER = /^\d{6}[A-Z]$/i;

export function normaliseCompanyNumber(input: string): string | null {
  const cleaned = input.replace(/[\s-]/g, "").toUpperCase();
  return COMPANY_NUMBER.test(cleaned) ? cleaned : null;
}

/** An Isle of Man company number starts with a letter; names do not. */
export function guessMode(input: string): RegistrySearchMode {
  const cleaned = input.replace(/[\s-]/g, "");
  return COMPANY_NUMBER.test(cleaned.toUpperCase()) ? "number" : "name";
}

/**
 * Build a search URL for the public registry.
 *
 * The mode is inferred from the input unless given explicitly, because the
 * registry will silently search the wrong field if you guess wrong: passing a
 * company number with searchby=0 returns no results rather than an error.
 */
export function companySearchUrl(input: string, mode?: RegistrySearchMode): string {
  const text = input.trim();
  const resolved = mode ?? guessMode(text);
  const params = new URLSearchParams({
    searchby: resolved === "number" ? "1" : "0",
    searchtext: text,
  });
  return `${COMPANIES_REGISTRY_SEARCH_URL}?${params.toString()}`;
}

/** Deep link for a known company number. Returns null if it is not a valid number. */
export function companyNumberUrl(input: string): string | null {
  const number = normaliseCompanyNumber(input);
  return number ? companySearchUrl(number, "number") : null;
}

export interface RegistryLookup {
  input: string;
  mode: RegistrySearchMode;
  url: string;
  /** True when we recognised the input as a company number rather than a name. */
  recognisedNumber: boolean;
  /** Fields the Registry will show for free, without an account. */
  freeFields: string[];
  /** Fields that require a registered account and payment. */
  gatedFields: string[];
}

/** Everything the lookup panel needs to render one row honestly. */
export function registryLookup(input: string): RegistryLookup | null {
  const text = input.trim();
  if (!text) return null;
  const mode = guessMode(text);
  const number = mode === "number" ? normaliseCompanyNumber(text) : null;

  return {
    input: text,
    mode,
    url: companySearchUrl(text, mode),
    recognisedNumber: number !== null,
    freeFields: [
      "Registered name",
      "Company number",
      "Company type",
      "Registration status",
      "Registered office address",
      "Registered agent",
      "Date of incorporation",
      "Whether charges are registered",
      "Liquidation / receivership flags",
      "Number of documents filed",
    ],
    gatedFields: [
      "Filed documents (annual returns, accounts, confirmation statements)",
      "Registered director and secretary details",
      "Registered charges and mortgages",
    ],
  };
}