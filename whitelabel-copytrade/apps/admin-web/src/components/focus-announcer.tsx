// # Responsibility: implements a Batch 04 commercial interface component or supporting utility.
// # Announces admin route changes through a polite live region and moves focus to the new page heading.
'use client';

import type { JSX } from 'react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

export default function AdminFocusAnnouncer(): JSX.Element {
  const pathname = usePathname();
  const initial = useRef(true);
  const live = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (initial.current) { initial.current = false; return; }
    const heading = document.querySelector<HTMLElement>('main h1, main [role="heading"][aria-level="1"]');
    if (heading) {
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
    if (live.current) live.current.textContent = heading?.textContent?.trim() ? `Page changed: ${heading.textContent.trim()}` : 'Page changed';
  }, [pathname]);
  return <span ref={live} className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="admin-focus-announcer" />;
}
