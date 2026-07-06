import { describe, it, expect, vi, beforeEach } from "vitest";

const { checkForAppUpdateMock } = vi.hoisted(() => ({
  checkForAppUpdateMock: vi.fn(),
}));
vi.mock("../transport/transport", () => ({
  checkForAppUpdate: checkForAppUpdateMock,
}));

import { checkForUpdate } from "./updater";

beforeEach(() => {
  checkForAppUpdateMock.mockReset();
});

describe("checkForUpdate", () => {
  it("returns null when the app is up to date", async () => {
    checkForAppUpdateMock.mockResolvedValue(null);
    expect(await checkForUpdate()).toBeNull();
  });

  it("maps the update's version and notes", async () => {
    checkForAppUpdateMock.mockResolvedValue({
      version: "0.2.0",
      body: "### Features\n- things",
      downloadAndInstall: vi.fn(),
    });
    const update = await checkForUpdate();
    expect(update?.version).toBe("0.2.0");
    expect(update?.notes).toBe("### Features\n- things");
  });

  it("defaults notes to an empty string", async () => {
    checkForAppUpdateMock.mockResolvedValue({ version: "0.2.0", downloadAndInstall: vi.fn() });
    expect((await checkForUpdate())?.notes).toBe("");
  });

  it("reports download percent from Started/Progress/Finished events", async () => {
    const downloadAndInstall = vi.fn(async (onEvent: (e: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 200 } });
      onEvent({ event: "Progress", data: { chunkLength: 50 } });
      onEvent({ event: "Progress", data: { chunkLength: 150 } });
      onEvent({ event: "Finished" });
    });
    checkForAppUpdateMock.mockResolvedValue({ version: "0.2.0", body: "", downloadAndInstall });

    const update = await checkForUpdate();
    const seen: Array<number | null> = [];
    await update?.download((pct) => seen.push(pct));

    expect(seen).toEqual([25, 100, 100]);
    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
  });

  it("reports null percent when the total size is unknown", async () => {
    const downloadAndInstall = vi.fn(async (onEvent: (e: unknown) => void) => {
      onEvent({ event: "Started", data: {} });
      onEvent({ event: "Progress", data: { chunkLength: 10 } });
    });
    checkForAppUpdateMock.mockResolvedValue({ version: "0.2.0", body: "", downloadAndInstall });

    const update = await checkForUpdate();
    const seen: Array<number | null> = [];
    await update?.download((pct) => seen.push(pct));

    expect(seen).toEqual([null]);
  });
});
