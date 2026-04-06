/**
 * Prefer readable IPv4 when Node/Express reports IPv4-mapped IPv6 (::ffff:x.x.x.x).
 * Use when persisting auth audit rows and when returning IPs to clients.
 */
export function normalizeClientIp(ip: string | undefined): string | undefined {
  if (ip == null || ip === "") return undefined;
  const t = ip.trim().slice(0, 100);
  if (t.startsWith("::ffff:")) {
    const v4 = t.slice(7);
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(v4)) return v4;
  }
  return t;
}

export function normalizeStoredIpForDisplay(ip: string | null | undefined): string | null {
  if (ip == null || ip === "") return null;
  return normalizeClientIp(ip) ?? null;
}
