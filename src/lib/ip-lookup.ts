/**
 * IP -> Isle of Man network lookup.
 *
 * Runs entirely in the browser against /data/prefix-index.json. That is a
 * deliberate choice over an API route: the whole index is under 5 KB, so
 * longest-prefix-match is a few microseconds of BigInt arithmetic, it works
 * offline, and it cannot be rate-limited or logged server-side. Nothing about
 * the lookup identifies a visitor.
 *
 * Scope, stated plainly because this is the easiest thing to over-claim:
 * this answers "which Isle of Man-registered operator announces a prefix
 * containing this address". It does NOT geolocate the address, does not
 * identify a subscriber, and is not a threat-intelligence product.
 */

export interface PrefixIndexNetwork {
  asn: number;
  holder: string;
  asName: string;
  routed: boolean;
  prefixCount: number;
  prefixes: string[];
}

export interface PrefixIndex {
  generated: string;
  country: string;
  ripestatQueryTime: string | null;
  source: { name: string; url: string; licence: string; note: string };
  registeredAsnCount: number;
  networkCount: number;
  networks: PrefixIndexNetwork[];
  unannounced: { asn: number; holder: string; routed: boolean }[];
}

export interface PrefixEntry {
  /** Inclusive first address. */
  start: bigint;
  /** Inclusive last address. */
  end: bigint;
  prefixLength: number;
  bits: 32 | 128;
  cidr: string;
  network: PrefixIndexNetwork;
}

export interface IpMatch {
  query: string;
  address: bigint;
  family: 4 | 6;
  /** Canonical form of the queried address. */
  addressText: string;
  /** Longest matching prefix, absent when found === false. */
  entry?: PrefixEntry;
  /** Every IoM-registered prefix containing the address, longest first. */
  allMatches: PrefixEntry[];
}

export interface LookupResult extends IpMatch {
  found: boolean;
  /** Set when found === false. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Address parsing
// ---------------------------------------------------------------------------

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function parseIPv4(input: string): bigint | null {
  const m = V4.exec(input);
  if (!m) return null;
  let value = 0n;
  for (let i = 1; i <= 4; i++) {
    const digits = m[i];
    // Leading zeros are rejected rather than read as decimal. "010.0.0.1" is
    // decimal 10 here and octal 8 in inet_aton and several CIDR tools, so
    // accepting it means the same string indexes as two different networks
    // depending on which side did the parsing.
    if (digits.length > 1 && digits.startsWith("0")) return null;
    const octet = Number(digits);
    if (octet > 255) return null;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

export function parseIPv6(input: string): bigint | null {
  let text = input;
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);
  if (!text.includes(":")) return null;

  // Rewrite a trailing dotted-quad (::ffff:1.2.3.4) into two hextets.
  if (text.includes(".")) {
    const cut = text.lastIndexOf(":");
    if (cut === -1) return null;
    const quad = parseIPv4(text.slice(cut + 1));
    if (quad === null) return null;
    const hi = (quad >> 16n) & 0xffffn;
    const lo = quad & 0xffffn;
    text = `${text.slice(0, cut + 1)}${hi.toString(16)}:${lo.toString(16)}`;
  }

  const compression = text.indexOf("::");
  let head: string[];
  let tail: string[];
  let compressed = false;
  if (compression !== -1) {
    if (text.indexOf("::", compression + 1) !== -1) return null;
    compressed = true;
    const left = text.slice(0, compression);
    const right = text.slice(compression + 2);
    head = left === "" ? [] : left.split(":");
    tail = right === "" ? [] : right.split(":");
  } else {
    head = text.split(":");
    tail = [];
  }

  const known = head.length + tail.length;
  if (compressed) {
    // `::` stands for AT LEAST one group of zeros, so a full eight groups
    // with a `::` in them is not a valid address either.
    if (known >= 8) return null;
  } else if (known !== 8) {
    // Without `::` every group must be present. Padding short input up to
    // eight - which is what this used to do - accepted "1:2:3" as a valid
    // address, and a malformed query then matched an indexed prefix and
    // reported a found network that does not exist.
    return null;
  }

  const groups = [...head, ...new Array<string>(8 - known).fill("0"), ...tail];
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

export function parseAddress(input: string): { value: bigint; family: 4 | 6 } | null {
  const text = input.trim();
  const v4 = parseIPv4(text);
  if (v4 !== null) return { value: v4, family: 4 };
  const v6 = parseIPv6(text);
  if (v6 !== null) return { value: v6, family: 6 };
  return null;
}

function toIPv4Text(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => Number((value >> shift) & 0xffn)).join(".");
}

function toIPv6Text(value: bigint): string {
  const groups: string[] = [];
  for (let shift = 112n; shift >= 0n; shift -= 16n) {
    groups.push(((value >> shift) & 0xffffn).toString(16));
  }
  return groups.join(":");
}

export function formatAddress(value: bigint, family: 4 | 6): string {
  return family === 4 ? toIPv4Text(value) : toIPv6Text(value);
}

function fullMask(bits: 32 | 128): bigint {
  return (1n << BigInt(bits)) - 1n;
}

/** Network mask: high `prefixLength` bits set, low host bits cleared. */
function maskFor(prefixLength: number, bits: 32 | 128): bigint {
  if (prefixLength <= 0) return 0n;
  const host = BigInt(bits) - BigInt(prefixLength);
  return fullMask(bits) ^ ((1n << host) - 1n);
}

/** Inverse of maskFor: the host bits, for turning a start address into an end. */
function hostMask(prefixLength: number, bits: 32 | 128): bigint {
  const full = fullMask(bits);
  return full ^ maskFor(prefixLength, bits);
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

interface CompiledIndex {
  entries: PrefixEntry[];
  maxPrefixLength: number;
}

let compiled: CompiledIndex | null = null;

/** Parse every CIDR in the index once and sort for longest-prefix-match. */
export function compileIndex(index: PrefixIndex): CompiledIndex {
  const entries: PrefixEntry[] = [];
  let maxPrefixLength = 0;

  for (const network of index.networks) {
    for (const cidr of network.prefixes) {
      const slash = cidr.lastIndexOf("/");
      if (slash === -1) continue;
      const parsed = parseAddress(cidr.slice(0, slash));
      const prefixLength = Number(cidr.slice(slash + 1));
      if (!parsed || !Number.isInteger(prefixLength)) continue;
      const { value, family } = parsed;
      const bits = family === 4 ? 32 : 128;
      if (prefixLength < 0 || prefixLength > bits) continue;

      const mask = maskFor(prefixLength, bits);
      const start = value & mask;
      entries.push({
        start,
        end: start | hostMask(prefixLength, bits),
        prefixLength,
        bits,
        cidr,
        network,
      });
      if (prefixLength > maxPrefixLength) maxPrefixLength = prefixLength;
    }
  }

  // Longest prefix first, so the first hit while scanning is the best hit.
  entries.sort((a, b) => b.prefixLength - a.prefixLength);
  return { entries, maxPrefixLength };
}

export function setIndex(index: PrefixIndex): void {
  compiled = compileIndex(index);
}

export function indexStats(index: PrefixIndex): CompiledIndex {
  if (!compiled) setIndex(index);
  return compiled as CompiledIndex;
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/** Every indexed prefix containing `value`, longest first. */
export function matchAll(index: PrefixIndex, value: bigint, family: 4 | 6): PrefixEntry[] {
  const { entries } = indexStats(index);
  const bits = family === 4 ? 32 : 128;
  const hits: PrefixEntry[] = [];
  for (const entry of entries) {
    if (entry.bits !== bits) continue;
    if (value >= entry.start && value <= entry.end) hits.push(entry);
  }
  return hits;
}

/**
 * Look up a single address or a CIDR.
 *
 * A CIDR query returns the longest indexed prefix that covers the whole
 * queried range, falling back to the best prefix covering its network address.
 */
export function lookup(index: PrefixIndex, query: string): LookupResult {
  const raw = query.trim();
  const base = {
    query: raw,
    address: 0n,
    family: 4 as const,
    addressText: raw,
    allMatches: [] as PrefixEntry[],
    found: false,
  };

  if (!raw) {
    return { ...base, reason: "Enter an IPv4 or IPv6 address." };
  }

  const slash = raw.lastIndexOf("/");
  const addrPart = slash === -1 ? raw : raw.slice(0, slash);
  const parsed = parseAddress(addrPart);
  if (!parsed) {
    return { ...base, reason: "Not a valid IPv4 or IPv6 address." };
  }

  const { value, family } = parsed;
  const addressText = formatAddress(value, family);

  let matches = matchAll(index, value, family);

  if (slash !== -1) {
    const prefixLength = Number(raw.slice(slash + 1));
    const bits = family === 4 ? 32 : 128;
    if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > bits) {
      return { ...base, address: value, family, addressText, reason: "Invalid prefix length." };
    }
    // Prefer a single IoM prefix that contains the entire queried range.
    const mask = maskFor(prefixLength, bits);
    const qStart = value & mask;
    const qEnd = qStart | hostMask(prefixLength, bits);
    const covering = matches.find((e) => e.start <= qStart && e.end >= qEnd);
    if (covering) matches = [covering, ...matches.filter((e) => e !== covering)];
  }

  const best = matches[0];
  if (!best) {
    return {
      ...base,
      address: value,
      family,
      addressText,
      reason: "No Isle of Man-registered ASN announces a prefix containing this address.",
    };
  }

  return {
    query: raw,
    address: value,
    family,
    addressText,
    entry: best,
    allMatches: matches,
    found: true,
  };
}

export function addressCount(entry: PrefixEntry): bigint {
  return entry.end - entry.start + 1n;
}

export function networkLabel(network: PrefixIndexNetwork): string {
  return network.asName || network.holder || `AS${network.asn}`;
}