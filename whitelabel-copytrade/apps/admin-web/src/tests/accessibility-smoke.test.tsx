// # Responsibility: verifies the Batch 04 commercial behavior and its safety contracts.
// # Checks admin focus announcements, semantic labels, and decision controls for accessibility regressions.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('admin accessibility smoke checks', () => {
  it('mounts route announcements and a skip link in the admin root layout', () => {
    const component = read('src/components/focus-announcer.tsx');
    const layout = read('src/app/layout.tsx');
    expect(component).toContain('aria-live="polite"');
    expect(component).toContain('role="status"');
    expect(layout).toContain('AdminFocusAnnouncer');
    expect(layout).toContain('Skip to main content');
  });

  it('labels each referral review decision reason and exposes status/errors', () => {
    const queue = read('src/features/partners/referral-abuse-queue.tsx');
    expect(queue).toContain('htmlFor={`reason-${item.id}`}');
    expect(queue).toContain('role="alert"');
    expect(queue).toContain('role="status"');
    expect(queue).toContain('Approve');
    expect(queue).toContain('Reject');
  });
});
