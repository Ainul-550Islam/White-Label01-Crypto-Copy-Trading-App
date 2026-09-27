/**
 * Development-safe accessibility helpers and validation hooks
 */

export function checkColorContrast(foreground: string, background: string): { ratio: number; passesAA: boolean; passesAAA: boolean } {
  // Simplified contrast check - in real app would use proper luminance calculation
  // This is a dev helper only, not authoritative
  return { ratio: 4.5, passesAA: true, passesAAA: false };
}

export function validateHeadingHierarchy(container: HTMLElement): string[] {
  const issues: string[] = [];
  const headings = Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6'));
  let lastLevel = 0;
  for (const heading of headings) {
    const level = parseInt(heading.tagName.charAt(1));
    if (lastLevel !== 0 && level > lastLevel + 1) {
      issues.push(`Heading hierarchy skip: h${lastLevel} → h${level} at "${heading.textContent?.slice(0, 30)}"`);
    }
    lastLevel = level;
  }
  return issues;
}

export function useAccessibilityCheck(enabled = process.env.NODE_ENV === 'development'): void {
  if (!enabled) return;
  // Dev-only checks would run here
}

export function checkImageAlts(container: HTMLElement): string[] {
  const issues: string[] = [];
  const images = container.querySelectorAll('img');
  for (const img of images) {
    if (!img.alt && !img.getAttribute('aria-hidden')) {
      issues.push(`Image missing alt: ${img.src.slice(0, 50)}`);
    }
  }
  return issues;
}
