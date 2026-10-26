// # Responsibility: implements a Batch 04 commercial interface component or supporting utility.
// # Announces client-side route changes accessibly and moves keyboard focus to the page heading after navigation.
'use client';

import type { JSX } from 'react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

export default function FocusAnnouncer(): JSX.Element {
  const pathname = usePathname();
  const firstRender = useRef(true);
  const region = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const heading = document.querySelector<HTMLElement>('main h1, main [role="heading"][aria-level="1"]');
    if (heading) {
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
      const text = heading.textContent?.trim();
      if (region.current) region.current.textContent = text ? `Page changed: ${text}` : 'Page changed';
    } else if (region.current) {
      region.current.textContent = 'Page changed';
    }
  }, [pathname]);

  return (
    <span
      ref={region}
      aria-live="polite"
      aria-atomic="true"
      role="status"
      className="sr-only"
      data-testid="focus-announcer"
    />
  );
}
