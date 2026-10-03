import { redirect } from "next/navigation";

/**
 * The plan catalogue is served by the authenticated billing portal
 * (subscription:read); there is no public pricing endpoint, so this entry
 * point forwards to the signed-in plans page instead of rendering a page whose
 * every request would be rejected.
 */
export default function Page(): never {
  redirect("/billing/plans");
}
