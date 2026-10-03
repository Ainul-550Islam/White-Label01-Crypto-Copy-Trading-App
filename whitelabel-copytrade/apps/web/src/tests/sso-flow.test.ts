/**
 * Part 11 - web BFF single sign-on helpers (/api/auth/sso/start, /callback).
 */
import {
  SSO_DEFAULT_RETURN,
  buildSsoCallbackBody,
  isAcceptableAuthorizationUrl,
  isSafeReturnPath,
  ssoStartRequestSchema,
  ssoSuccessPath,
} from "../lib/sso-flow";

describe("sso-flow helpers", () => {
  test("returnTo must be an app-relative path (same rule as the API)", () => {
    for (const ok of ["/dashboard", "/portfolio?tab=open", "/a/b#c"])
      expect(isSafeReturnPath(ok)).toBe(true);
    for (const bad of [
      "",
      "dashboard",
      "//evil.example",
      "/\\evil",
      "https://evil.example/",
      "/javascript:alert(1)",
      "/a\nb",
      5,
      null,
    ]) {
      expect(isSafeReturnPath(bad)).toBe(false);
    }
    expect(ssoSuccessPath("/portfolio")).toBe("/portfolio");
    expect(ssoSuccessPath("https://evil.example")).toBe(SSO_DEFAULT_RETURN);
    expect(ssoSuccessPath(null)).toBe(SSO_DEFAULT_RETURN);
  });

  test("the start body accepts only providerType and a safe returnTo - never a tenant id", () => {
    // Round 8: no default provider - the API starts the tenant's enabled one (OIDC or SAML).
    expect(ssoStartRequestSchema.parse({})).toEqual({});
    expect(
      ssoStartRequestSchema.parse({ providerType: "SAML", returnTo: "/x" }),
    ).toEqual({ providerType: "SAML", returnTo: "/x" });
    expect(
      ssoStartRequestSchema.safeParse({ providerType: "OIDC", tenantId: "t-1" })
        .success,
    ).toBe(false);
    expect(
      ssoStartRequestSchema.safeParse({ providerType: "LDAP" }).success,
    ).toBe(false);
    expect(
      ssoStartRequestSchema.safeParse({ returnTo: "//evil.example" }).success,
    ).toBe(false);
  });

  test("only https IdP URLs are handed to the browser (http loopback outside production)", () => {
    expect(
      isAcceptableAuthorizationUrl("https://idp.example/authorize?x=1", true),
    ).toBe(true);
    expect(
      isAcceptableAuthorizationUrl("http://idp.example/authorize", true),
    ).toBe(false);
    expect(
      isAcceptableAuthorizationUrl("http://localhost:8080/authorize", true),
    ).toBe(false);
    expect(
      isAcceptableAuthorizationUrl("http://localhost:8080/authorize", false),
    ).toBe(true);
    expect(isAcceptableAuthorizationUrl("javascript:alert(1)", false)).toBe(
      false,
    );
    expect(isAcceptableAuthorizationUrl("not a url", false)).toBe(false);
  });

  test("the callback body takes state/code/error from the redirect and the binding secret + device id from cookies only", () => {
    const query = new URLSearchParams({
      state: "s1",
      code: "c1",
      bindingToken: "from-query",
      deviceId: "from-query",
      tenantId: "t",
    });
    expect(buildSsoCallbackBody(query, "bind-cookie", "web-device")).toEqual({
      state: "s1",
      code: "c1",
      bindingToken: "bind-cookie",
      deviceId: "web-device",
      deviceName: "Customer Web",
      platform: "web",
    });
    expect(
      buildSsoCallbackBody(
        new URLSearchParams({ state: "s1", error: "access_denied" }),
        "b",
        "d",
      ),
    ).toMatchObject({ error: "access_denied" });
  });

  test("no callback without state, without code/error, or without the binding cookies", () => {
    expect(
      buildSsoCallbackBody(new URLSearchParams({ code: "c" }), "b", "d"),
    ).toBeNull();
    expect(
      buildSsoCallbackBody(new URLSearchParams({ state: "s" }), "b", "d"),
    ).toBeNull();
    expect(
      buildSsoCallbackBody(
        new URLSearchParams({ state: "s", code: "c" }),
        undefined,
        "d",
      ),
    ).toBeNull();
    expect(
      buildSsoCallbackBody(
        new URLSearchParams({ state: "s", code: "c" }),
        "b",
        undefined,
      ),
    ).toBeNull();
    expect(
      buildSsoCallbackBody(
        new URLSearchParams({ state: "s".repeat(5000), code: "c" }),
        "b",
        "d",
      ),
    ).toBeNull();
  });
});
