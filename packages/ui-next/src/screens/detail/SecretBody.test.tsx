import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { K8sObject, PodMetric, PodSummary } from "@srelens/core";

// `SecretDetailsBody` reads the real (base64) values via core's gated
// `getSecret` (`getObject` redacts Secret data) — mocked here so a test
// controls what "the cluster said" without one. A Secret has no
// `relatedPodSelector` match, so `podsForSelector`/`podMetrics` are mocked
// only so the composition test can render `GenericBody` without a live
// cluster call escaping the mock boundary. `importOriginal` keeps every
// formatter (`decodeBase64`, `dockerRegistries`, `formatBytes`, ...) intact.
const { getSecret, podsForSelector, podMetrics } = vi.hoisted(() => ({
  getSecret: vi.fn(async (): Promise<{ data?: Record<string, string>; error?: string }> => ({ data: undefined })),
  podsForSelector: vi.fn(async (): Promise<{ pods?: PodSummary[]; error?: string }> => ({ pods: [] })),
  podMetrics: vi.fn(async (): Promise<{ metrics?: PodMetric[]; error?: string }> => ({ metrics: [] })),
}));

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  getSecret,
  podsForSelector,
  podMetrics,
}));

import { GenericBody } from "./GenericBody";
import { SecretDetailsBody } from "./SecretBody";

// Obviously-fake fixture text — never anything that reads as a real
// credential, per the task's secrecy ruling.
const FIXTURE_VALUE = "fixture-only-not-a-real-secret";
const FIXTURE_B64 = btoa(FIXTURE_VALUE);

function secret(
  data: Record<string, string> = {},
  overrides: Partial<K8sObject> = {},
  metadata: NonNullable<K8sObject["metadata"]> = { name: "s-1", namespace: "default" },
): K8sObject {
  return { kind: "Secret", apiVersion: "v1", metadata, data, ...overrides } as K8sObject;
}

/** Scans the whole rendered document for a substring — text content, `title`,
 *  `aria-label`, `data-*`, everything, including markup a screen reader or a
 *  DOM inspector would see even while visually hidden. A boolean assertion
 *  rather than an element query, so a failure here never prints the secret
 *  text into the test output. */
function documentContains(value: string): boolean {
  return document.body.innerHTML.includes(value);
}

describe("SecretDetailsBody", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSecret.mockResolvedValue({ data: undefined });
    podsForSelector.mockResolvedValue({ pods: [] });
    podMetrics.mockResolvedValue({ metrics: [] });
  });

  describe("the secrecy ruling", () => {
    it("keeps a fetched value out of the document until it is revealed, then shows it, then hides it again", async () => {
      getSecret.mockResolvedValue({ data: { token: FIXTURE_B64 } });
      render(<SecretDetailsBody object={secret({ token: "" })} context="ctx" />);

      await waitFor(() => expect(getSecret).toHaveBeenCalledWith("ctx", "default", "s-1"));
      // The fetched value is in memory now, but must not be in the document —
      // not as text, not as a title/aria-label/data-* attribute, and not in
      // the accessibility tree behind a visually-hidden style.
      expect(documentContains(FIXTURE_VALUE)).toBe(false);
      expect(documentContains(FIXTURE_B64)).toBe(false);
      expect(screen.queryByText(FIXTURE_VALUE)).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Reveal" }));
      await waitFor(() => expect(documentContains(FIXTURE_VALUE)).toBe(true));

      await userEvent.click(screen.getByRole("button", { name: "Hide" }));
      expect(documentContains(FIXTURE_VALUE)).toBe(false);
    });

    it("never exposes the value through the toggle button's own accessible name", async () => {
      getSecret.mockResolvedValue({ data: { token: FIXTURE_B64 } });
      render(<SecretDetailsBody object={secret({ token: "" })} context="ctx" />);
      await waitFor(() => expect(getSecret).toHaveBeenCalled());
      const toggle = screen.getByRole("button", { name: "Reveal" });
      expect(toggle.getAttribute("title")).toBeNull();
      expect(toggle.getAttribute("aria-label")).toBeNull();
    });

    it("shows the masked placeholder, not an empty value, before reveal", async () => {
      getSecret.mockResolvedValue({ data: { token: FIXTURE_B64 } });
      render(<SecretDetailsBody object={secret({ token: "" })} context="ctx" />);
      await waitFor(() => expect(getSecret).toHaveBeenCalled());
      expect(screen.getByText("••••••••")).toBeDefined();
    });

    it("falls back to the redacted (blank) keys while the fetch is still in flight", () => {
      getSecret.mockImplementation(() => new Promise(() => {}));
      render(<SecretDetailsBody object={secret({ token: "" })} context="ctx" />);
      expect(screen.getByText("token")).toBeDefined();
      expect(screen.getByText("••••••••")).toBeDefined();
    });
  });

  describe("a general (Opaque) secret", () => {
    it("shows the Secret summary: type, key count, and immutable", async () => {
      render(<SecretDetailsBody object={secret({ token: "" }, { type: "Opaque", immutable: true })} context="ctx" />);
      await waitFor(() => expect(getSecret).toHaveBeenCalled());
      expect(screen.getByText("Secret summary")).toBeDefined();
      expect(screen.getByText("Opaque")).toBeDefined();
      expect(screen.getByText("1 key")).toBeDefined();
      expect(screen.getByText("Yes")).toBeDefined();
    });

    it("defaults type to Opaque and immutable to No when absent", async () => {
      render(<SecretDetailsBody object={secret({})} context="ctx" />);
      await waitFor(() => expect(getSecret).toHaveBeenCalled());
      expect(screen.getByText("Opaque")).toBeDefined();
      expect(screen.getByText("No")).toBeDefined();
    });

    it("shows an empty state for a secret with no data", async () => {
      render(<SecretDetailsBody object={secret({})} context="ctx" />);
      await waitFor(() => expect(getSecret).toHaveBeenCalled());
      expect(screen.getByText("Data (0 keys)")).toBeDefined();
      expect(screen.getByText("No data")).toBeDefined();
    });

    it("does not render TLS material or Docker registries sections", async () => {
      render(<SecretDetailsBody object={secret({ token: "" })} context="ctx" />);
      await waitFor(() => expect(getSecret).toHaveBeenCalled());
      expect(screen.queryByText("TLS material")).toBeNull();
      expect(screen.queryByText("Docker registries")).toBeNull();
    });
  });

  describe("a kubernetes.io/tls secret", () => {
    const CERT =
      "-----BEGIN CERTIFICATE-----\nFAKE-NOT-A-REAL-CERTIFICATE\n-----END CERTIFICATE-----\n";
    const KEY = "-----BEGIN PRIVATE KEY-----\nFAKE-NOT-A-REAL-KEY\n-----END PRIVATE KEY-----\n";

    it("shows the certificate count, private key format, and encoded sizes", async () => {
      render(
        <SecretDetailsBody
          object={secret({ "tls.crt": btoa(CERT), "tls.key": btoa(KEY) }, { type: "kubernetes.io/tls" })}
          context="ctx"
        />,
      );
      await waitFor(() => expect(getSecret).toHaveBeenCalled());
      expect(screen.getByText("TLS material")).toBeDefined();
      expect(screen.getByText("kubernetes.io/tls")).toBeDefined();
      expect(screen.getByText("1 certificate")).toBeDefined();
      expect(screen.getByText("PKCS#8")).toBeDefined();
    });

    it("reports a missing certificate rather than a count of zero", async () => {
      render(
        <SecretDetailsBody object={secret({ "tls.key": btoa(KEY) }, { type: "kubernetes.io/tls" })} context="ctx" />,
      );
      await waitFor(() => expect(getSecret).toHaveBeenCalled());
      expect(screen.getByText("Missing tls.crt")).toBeDefined();
    });

    it("reports a missing private key", async () => {
      render(
        <SecretDetailsBody object={secret({ "tls.crt": btoa(CERT) }, { type: "kubernetes.io/tls" })} context="ctx" />,
      );
      await waitFor(() => expect(getSecret).toHaveBeenCalled());
      expect(screen.getByText("Missing")).toBeDefined();
    });

    it("still shows the Data section with tls.crt and tls.key masked", async () => {
      render(
        <SecretDetailsBody
          object={secret({ "tls.crt": btoa(CERT), "tls.key": btoa(KEY) }, { type: "kubernetes.io/tls" })}
          context="ctx"
        />,
      );
      await waitFor(() => expect(getSecret).toHaveBeenCalled());
      expect(screen.getByText("tls.crt")).toBeDefined();
      expect(screen.getByText("tls.key")).toBeDefined();
      expect(screen.getAllByText("••••••••")).toHaveLength(2);
      expect(documentContains(CERT)).toBe(false);
      expect(documentContains(KEY)).toBe(false);
    });
  });

  describe("a kubernetes.io/dockerconfigjson secret", () => {
    const DOCKER_CONFIG = JSON.stringify({
      auths: { "registry.example.test": { username: "robot", password: "fixture-only-not-real" } },
    });

    it("summarises registries without exposing the password", async () => {
      render(
        <SecretDetailsBody
          object={secret(
            { ".dockerconfigjson": btoa(DOCKER_CONFIG) },
            { type: "kubernetes.io/dockerconfigjson" },
          )}
          context="ctx"
        />,
      );
      await waitFor(() => expect(getSecret).toHaveBeenCalled());
      expect(screen.getByText("Docker registries")).toBeDefined();
      expect(screen.getByText("registry.example.test")).toBeDefined();
      expect(screen.getByText("robot")).toBeDefined();
      expect(screen.getByText("Stored")).toBeDefined();
      expect(documentContains("fixture-only-not-real")).toBe(false);
    });

    it("shows an empty state when no valid registry credentials are found", async () => {
      render(
        <SecretDetailsBody
          object={secret({ ".dockerconfigjson": btoa("not json") }, { type: "kubernetes.io/dockerconfigjson" })}
          context="ctx"
        />,
      );
      await waitFor(() => expect(getSecret).toHaveBeenCalled());
      expect(screen.getByText("No valid registry credentials found")).toBeDefined();
    });
  });

  describe("composition with GenericBody", () => {
    it("renders exactly one Metadata heading and no Pods section", async () => {
      const s = secret({ token: "" });
      render(
        <GenericBody kind="Secret" object={s} context="ctx">
          <SecretDetailsBody object={s} context="ctx" />
        </GenericBody>,
      );
      await waitFor(() => expect(getSecret).toHaveBeenCalled());
      expect(screen.getAllByRole("heading", { name: "Metadata" })).toHaveLength(1);
      expect(screen.queryAllByRole("heading", { name: "Pods" })).toHaveLength(0);
      expect(podsForSelector).not.toHaveBeenCalled();
    });
  });
});
