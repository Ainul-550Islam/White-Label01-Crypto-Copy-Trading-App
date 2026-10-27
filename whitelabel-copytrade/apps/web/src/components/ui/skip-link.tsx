'use client';

import type { JSX, MouseEvent, ReactNode } from 'react';

/** Focus the content after shell navigation; ordinary hash navigation is the fallback. */
export function SkipLink({ children }: { children: ReactNode }): JSX.Element {
  function skip(event: MouseEvent<HTMLAnchorElement>): void {
    const target = document.querySelector<HTMLElement>('[data-skip-target]');
    if (target) {
      event.preventDefault();
      target.focus();
    }
  }
  return <a className="skip-link" href="#main-content" onClick={skip}>{children}</a>;
}
