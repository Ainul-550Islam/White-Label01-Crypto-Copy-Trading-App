// # Responsibility: verifies the Batch 04 commercial behavior and its safety contracts.
// # Checks accessible navigation announcements, landmarks, skip-link conventions, and named-control policy in customer surfaces.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('customer accessibility smoke checks', () => {
  it('mounts a polite route announcement and a skip link in the root application', () => {
    const component = read('src/components/ui/focus-announcer.tsx');
    const layout = read('src/app/layout.tsx');
    expect(component).toContain('aria-live="polite"');
    expect(component).toContain('role="status"');
    expect(component).toContain('heading.focus');
    expect(layout).toContain('FocusAnnouncer');
    expect(layout).toContain('Skip to main content');
  });

  it('keeps public route and form components on semantic labels and landmarks', () => {
    const partner = read('src/features/partner/affiliate-attribution-panel.tsx');
    expect(partner).toContain('<section');
    expect(partner).toContain('<h2');
    expect(partner).toContain('<caption');
    expect(partner).toContain('scope="col"');
  });

  it('has no unlabeled forms in the localization settings surface', () => {
    const settings = read('src/features/settings/localization-settings-page.tsx');
    expect(settings).toMatch(/<label[\s\S]*?htmlFor=/);
    expect(settings).toContain('aria-live');
  });
});
