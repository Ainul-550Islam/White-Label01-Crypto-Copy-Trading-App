import type { EmailJob } from '@wlct/shared-types';

/**
 * Renders the branded HTML and plain-text bodies for a transactional email.
 *
 * The API has already localised the subject and body, so this layer only
 * applies the tenant's visual identity. All interpolated values are HTML
 * escaped: branding data is operator-supplied, and an unescaped app name would
 * be a stored-XSS vector in every recipient's inbox.
 */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s) URLs are allowed through; anything else is dropped. */
function safeUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** A hex colour, or the safe default when the value is not one. */
function safeColor(value: string, fallback: string): string {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : fallback;
}

export function renderEmail(job: EmailJob): RenderedEmail {
  const appName = escapeHtml(job.branding.appName);
  const primary = safeColor(job.branding.primaryColor, '#1B2A4A');
  const logoUrl = safeUrl(job.branding.logoUrl);
  const supportEmail = job.branding.supportEmail ? escapeHtml(job.branding.supportEmail) : null;
  const subject = job.subject;
  const body = escapeHtml(job.body);
  const year = new Date().getUTCFullYear();

  const html = `<!doctype html>
<html lang="${escapeHtml(job.locale)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,0.08);">
            <tr>
              <td style="background:${primary};padding:24px;text-align:center;">
                ${
                  logoUrl
                    ? `<img src="${escapeHtml(logoUrl)}" alt="${appName}" height="36" style="height:36px;display:block;margin:0 auto;" />`
                    : `<span style="color:#ffffff;font-size:20px;font-weight:600;">${appName}</span>`
                }
              </td>
            </tr>
            <tr>
              <td style="padding:32px 32px 8px 32px;">
                <h1 style="margin:0 0 16px 0;font-size:20px;line-height:28px;color:#0b1220;">${escapeHtml(subject)}</h1>
                <p style="margin:0;font-size:15px;line-height:24px;color:#3c4a5e;">${body}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 32px 32px;">
                <p style="margin:0;font-size:13px;line-height:20px;color:#6b7a90;">
                  This is an automated message from ${appName}.${
                    supportEmail
                      ? ` If you need help, contact <a href="mailto:${supportEmail}" style="color:${primary};">${supportEmail}</a>.`
                      : ''
                  }
                </p>
              </td>
            </tr>
            <tr>
              <td style="background:#f7f9fc;padding:16px 32px;text-align:center;">
                <p style="margin:0;font-size:12px;line-height:18px;color:#8a97a8;">&copy; ${year} ${appName}. All rights reserved.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    subject,
    '',
    job.body,
    '',
    `This is an automated message from ${job.branding.appName}.`,
    job.branding.supportEmail ? `Need help? ${job.branding.supportEmail}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, html, text };
}
