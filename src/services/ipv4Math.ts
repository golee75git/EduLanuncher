export interface Ipv4Range {
  address: string;
  prefix: number;
  mask: string;
  network: string;
  broadcast: string;
  firstHost: string | null;
  lastHost: string | null;
  usableHosts: number;
}

function parseOctets(text: string): number | null {
  const parts = text.trim().split(".");
  if (parts.length !== 4) {
    return null;
  }
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet > 255) {
      return null;
    }
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

function formatIpv4(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join(".");
}

function prefixFromMask(mask: number): number | null {
  let prefix = 0;
  let seenZero = false;
  for (let bit = 31; bit >= 0; bit -= 1) {
    const one = ((mask >>> bit) & 1) === 1;
    if (one) {
      if (seenZero) {
        return null;
      }
      prefix += 1;
    } else {
      seenZero = true;
    }
  }
  return prefix;
}

export function ipv4ToNumber(text: string): number | null {
  return parseOctets(text);
}

export function numberToIpv4(value: number): string {
  return formatIpv4(value);
}

export function listIpv4Inclusive(start: string, end: string): string[] | null {
  const first = parseOctets(start);
  const last = parseOctets(end);
  if (first === null || last === null || first > last) {
    return null;
  }
  const count = last - first + 1;
  if (count > 256) {
    return null;
  }
  const addresses: string[] = [];
  for (let value = first; value <= last; value += 1) {
    addresses.push(formatIpv4(value));
  }
  return addresses;
}

export function parsePrefixInput(text: string): number | null {
  const trimmed = text.trim().replace(/^\//, "");
  if (/^\d{1,2}$/.test(trimmed)) {
    const prefix = Number(trimmed);
    return prefix >= 0 && prefix <= 32 ? prefix : null;
  }
  const mask = parseOctets(trimmed);
  if (mask === null) {
    return null;
  }
  return prefixFromMask(mask);
}

export function maskFromPrefix(prefix: number): number {
  if (prefix <= 0) {
    return 0;
  }
  if (prefix >= 32) {
    return 0xffffffff >>> 0;
  }
  return (0xffffffff << (32 - prefix)) >>> 0;
}

export function calculateIpv4Range(addressText: string, prefixText: string): Ipv4Range | null {
  const address = parseOctets(addressText);
  const prefix = parsePrefixInput(prefixText);
  if (address === null || prefix === null) {
    return null;
  }
  const mask = maskFromPrefix(prefix);
  const network = (address & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const hostBits = 32 - prefix;
  let firstHost: string | null = null;
  let lastHost: string | null = null;
  let usableHosts = 0;
  if (hostBits === 0) {
    usableHosts = 1;
    firstHost = formatIpv4(network);
    lastHost = formatIpv4(network);
  } else if (hostBits === 1) {
    usableHosts = 2;
    firstHost = formatIpv4(network);
    lastHost = formatIpv4(broadcast);
  } else {
    usableHosts = 2 ** hostBits - 2;
    firstHost = formatIpv4((network + 1) >>> 0);
    lastHost = formatIpv4((broadcast - 1) >>> 0);
  }
  return {
    address: formatIpv4(address),
    prefix,
    mask: formatIpv4(mask),
    network: formatIpv4(network),
    broadcast: formatIpv4(broadcast),
    firstHost,
    lastHost,
    usableHosts,
  };
}
