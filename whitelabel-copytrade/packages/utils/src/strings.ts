/** Deterministic string helpers used across services. */

export function slugify(value: string, maxLength = 63): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Extracts the tenant sub-domain from a host header, if any. */
export function extractSubdomain(host: string, rootDomain: string): string | null {
  const hostname = host.split(':')[0].toLowerCase();
  const root = rootDomain.toLowerCase();
  if (hostname === root || !hostname.endsWith(`.${root}`)) {
    return null;
  }
  const prefix = hostname.slice(0, hostname.length - root.length - 1);
  if (!prefix || prefix.includes('.')) {
    return prefix.split('.').pop() ?? null;
  }
  return prefix;
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}

export function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
};

/** Defence-in-depth escaping for values echoed into HTML (emails, exports). */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'/]/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** Removes control characters that could forge log lines. */
export function sanitiseForLog(value: string, maxLength = 512): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, maxLength)
    .trim();
}

export function isValidHexColor(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value);
}

export function isValidDomain(value: string): boolean {
  return /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(
    value.toLowerCase(),
  );
}
