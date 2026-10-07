// # Registers /traders/compare route
// # Registers /support customer route
export interface AppRouteDefinition {
  path: string;
  label: string;
  section: "trading" | "portfolio" | "partner" | "account" | "support";
  requiresAuth: boolean;
}

export const APP_ROUTES: Record<string, AppRouteDefinition> = {
  dashboard: { path: "/dashboard", label: "Dashboard", section: "trading", requiresAuth: true },
  traders: { path: "/traders", label: "Traders", section: "trading", requiresAuth: true },
  traderCompare: { path: "/traders/compare", label: "Compare Traders", section: "trading", requiresAuth: true },
  strategies: { path: "/strategies", label: "Strategies", section: "trading", requiresAuth: true },
  copyTrading: { path: "/copy-trading", label: "Copy Trading", section: "trading", requiresAuth: true },
  portfolio: { path: "/portfolio", label: "Portfolio", section: "portfolio", requiresAuth: true },
  exchanges: { path: "/exchanges", label: "Exchanges", section: "trading", requiresAuth: true },
  funding: { path: "/funding", label: "Funding", section: "portfolio", requiresAuth: true },
  partner: { path: "/partner", label: "Partner Portal", section: "partner", requiresAuth: true },
  partnerReferrals: { path: "/partner/referrals", label: "Referrals & Campaigns", section: "partner", requiresAuth: true },
  partnerCommissions: { path: "/partner/commissions", label: "Commission Ledger", section: "partner", requiresAuth: true },
  partnerPayouts: { path: "/partner/payouts", label: "Partner Payouts", section: "partner", requiresAuth: true },
  activity: { path: "/activity", label: "Activity & Audit", section: "account", requiresAuth: true },
  notifications: { path: "/notifications", label: "Notifications", section: "account", requiresAuth: true },
  support: { path: "/support", label: "Support & Helpdesk", section: "support", requiresAuth: true },
  account: { path: "/account", label: "Account", section: "account", requiresAuth: true },
};
