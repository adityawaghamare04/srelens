import { describe, it, expect } from "vitest";
import { decodeBase64, dockerRegistries } from "./k8sSecret";

// Classic (apps/desktop/src/components/ResourceOverview.test.tsx) never unit-tests
// decodeBase64 or dockerRegistries directly — it only exercises them indirectly
// through render tests (ObjectDetail rendering a Secret) that stay behind with
// the frozen design. So every test below is newly written against the moved
// bodies, not moved from classic. Fixture values are synthetic placeholders,
// not anything resembling a real credential.

describe("decodeBase64", () => {
  it("decodes a base64 string back to its original text", () => {
    expect(decodeBase64(btoa("placeholder-value-123"))).toBe("placeholder-value-123");
  });

  it("decodes multi-byte UTF-8 content via TextDecoder, not a naive char-code map", () => {
    // If this were implemented as String.fromCharCode(...bytes) instead of
    // TextDecoder, a multi-byte UTF-8 character would come back mangled.
    const original = "café-plåceholder";
    const bytes = new TextEncoder().encode(original);
    let binary = "";
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    expect(decodeBase64(btoa(binary))).toBe(original);
  });

  it("returns the input unchanged when it is not valid base64", () => {
    expect(decodeBase64("not-@@valid@@-base64")).toBe("not-@@valid@@-base64");
  });
});

describe("dockerRegistries", () => {
  it("prefers the explicit username field over one decoded from `auth`", () => {
    const authField = btoa("decoded-user:decoded-pass");
    const config = {
      auths: {
        "registry.example.test": { username: "field-user", auth: authField },
      },
    };
    const data = { ".dockerconfigjson": btoa(JSON.stringify(config)) };
    expect(dockerRegistries(data, "kubernetes.io/dockerconfigjson")).toEqual([
      { registry: "registry.example.test", username: "field-user", credential: "Stored" },
    ]);
  });

  it("falls back to the username decoded from `auth` when no username field is present", () => {
    const authField = btoa("svc-account:tok3n-placeholder");
    const config = {
      auths: {
        "registry2.example.test": { auth: authField },
      },
    };
    const data = { ".dockerconfigjson": btoa(JSON.stringify(config)) };
    expect(dockerRegistries(data, "kubernetes.io/dockerconfigjson")).toEqual([
      { registry: "registry2.example.test", username: "svc-account", credential: "Stored" },
    ]);
  });

  it("reports an identity token entry as 'Identity token' and uses — for a missing username", () => {
    const config = {
      auths: {
        "registry3.example.test": { identitytoken: "placeholder-identity-token" },
      },
    };
    const data = { ".dockerconfigjson": btoa(JSON.stringify(config)) };
    expect(dockerRegistries(data, "kubernetes.io/dockerconfigjson")).toEqual([
      { registry: "registry3.example.test", username: "—", credential: "Identity token" },
    ]);
  });

  it("reports 'Stored' for a bare password entry, independent of `auth`", () => {
    const config = {
      auths: {
        "registry4.example.test": { password: "placeholder-password" },
      },
    };
    const data = { ".dockerconfigjson": btoa(JSON.stringify(config)) };
    expect(dockerRegistries(data, "kubernetes.io/dockerconfigjson")).toEqual([
      { registry: "registry4.example.test", username: "—", credential: "Stored" },
    ]);
  });

  it("reports 'Missing' when an entry has no auth, password, or identity token", () => {
    const config = { auths: { "registry5.example.test": {} } };
    const data = { ".dockerconfigjson": btoa(JSON.stringify(config)) };
    expect(dockerRegistries(data, "kubernetes.io/dockerconfigjson")).toEqual([
      { registry: "registry5.example.test", username: "—", credential: "Missing" },
    ]);
  });

  it("a falsy but non-empty `auth` (e.g. 0) still decodes to '', not to a stringified digit", () => {
    // auth: 0 is falsy, so the `auth.auth ? decodeBase64(...) : ""` guard must
    // short-circuit to "". Without the guard, decodeBase64(str(0)) would
    // evaluate decodeBase64("0"), which (since "0" isn't valid base64) falls
    // back to returning "0" itself — a distinguishable, wrong username.
    const config = { auths: { "registry6.example.test": { auth: 0 } } };
    const data = { ".dockerconfigjson": btoa(JSON.stringify(config)) };
    expect(dockerRegistries(data, "kubernetes.io/dockerconfigjson")).toEqual([
      { registry: "registry6.example.test", username: "—", credential: "Missing" },
    ]);
  });

  it("reads the legacy .dockercfg shape (registries at the top level, no `auths` wrapper)", () => {
    const authField = btoa("legacy-user:legacy-pass");
    const config = { "legacy.example.test": { auth: authField } };
    const data = { ".dockercfg": btoa(JSON.stringify(config)) };
    expect(dockerRegistries(data, "kubernetes.io/dockercfg")).toEqual([
      { registry: "legacy.example.test", username: "legacy-user", credential: "Stored" },
    ]);
  });

  it("returns [] when the expected data key is missing (JSON.parse fails on '')", () => {
    expect(dockerRegistries({}, "kubernetes.io/dockerconfigjson")).toEqual([]);
  });

  it("returns [] when the decoded value is not valid JSON", () => {
    const data = { ".dockerconfigjson": btoa("not json at all") };
    expect(dockerRegistries(data, "kubernetes.io/dockerconfigjson")).toEqual([]);
  });
});
