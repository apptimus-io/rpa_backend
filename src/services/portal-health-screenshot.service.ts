import { chromium } from "playwright";
import { createPortalHealthScreenshotUpload, uploadImageBufferToCloudinary } from "./cloudinary.service.js";

export type PortalHealthScreenshotResult = {
  screenshotUpload: ReturnType<typeof createPortalHealthScreenshotUpload>;
  screenshotUrl: string | null;
  screenshotMessage: string;
};

export async function captureAndUploadPortalHealthScreenshot(portalId: string, loginUrl: string, options: { capture?: boolean } = {}): Promise<PortalHealthScreenshotResult> {
  const screenshotUpload = createPortalHealthScreenshotUpload({ portalId });
  if (options.capture === false) {
    return {
      screenshotUpload,
      screenshotUrl: null,
      screenshotMessage: "Screenshot capture skipped for non-browser verification."
    };
  }

  if (!screenshotUpload.configured) {
    return {
      screenshotUpload,
      screenshotUrl: null,
      screenshotMessage: "Cloudinary is not fully configured, so the health screenshot was not uploaded."
    };
  }

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1366, height: 900 } });
    const page = await context.newPage();
    await page.goto(loginUrl, { waitUntil: "commit", timeout: 30_000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(1_500);
    const buffer = await page.screenshot({ fullPage: true, type: "png" });
    await context.close();

    const uploaded = await uploadImageBufferToCloudinary({
      buffer,
      folder: screenshotUpload.folder,
      publicId: screenshotUpload.publicId
    });

    return {
      screenshotUpload,
      screenshotUrl: uploaded.secureUrl,
      screenshotMessage: uploaded.uploaded
        ? "Live portal login screenshot captured and uploaded to Cloudinary."
        : `Screenshot captured but Cloudinary upload did not complete (${uploaded.result}).`
    };
  } catch (error) {
    return {
      screenshotUpload,
      screenshotUrl: null,
      screenshotMessage: `Cloudinary screenshot upload could not be completed: ${error instanceof Error ? error.message : "unknown error"}.`
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
