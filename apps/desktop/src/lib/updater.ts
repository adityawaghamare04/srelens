import { checkForAppUpdate } from "../transport/transport";

/** An update ready to be downloaded and installed. */
export interface AvailableUpdate {
  version: string;
  notes: string;
  /**
   * Download and install the update. Progress is reported as a whole percent,
   * or null when the server didn't announce a total size. After this resolves
   * the app must be relaunched for the new version to run.
   */
  download(onProgress?: (percent: number | null) => void): Promise<void>;
}

/** Ask the update endpoint whether a newer version exists (null = up to date). */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  const update = await checkForAppUpdate();
  if (!update) return null;
  return {
    version: update.version,
    notes: update.body ?? "",
    download: async (onProgress) => {
      let total: number | null = null;
      let received = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          onProgress?.(total ? Math.round((received / total) * 100) : null);
        } else if (event.event === "Finished") {
          onProgress?.(100);
        }
      });
    },
  };
}
