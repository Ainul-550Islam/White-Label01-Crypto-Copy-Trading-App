// # Maps Tailwind utility colors to runtime tenant branding variables.
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--brand-background)',
        card: 'var(--brand-card, var(--brand-background))',
        primary: 'var(--brand-primary)',
        secondary: 'var(--brand-secondary)',
        accent: 'var(--brand-accent)',
        foreground: 'var(--brand-text)',
        muted: 'var(--brand-muted, hsl(215.4 16.3% 46.9%))',
        border: 'var(--brand-border, #e5e7eb)',
      },
    },
  },
  plugins: [],
};

export default config;
