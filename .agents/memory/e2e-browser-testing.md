---
name: Browser E2E testing of the Expo app
description: How to click through the Expo web preview headlessly in this workspace, and what differs on web vs device.
---

The Screenshot tool cannot tap, so flows (start quote, capture, create, paywall sheet) are verified with a headless browser.

- A Chromium binary exists at `/repl/tools/bin/chromium`. Install `playwright-core` in a scratch folder outside the workspace (e.g. `/tmp/e2e`), never in the project, and launch with `executablePath` set to that binary and `--no-sandbox`.
- Target `https://$REPLIT_EXPO_DEV_DOMAIN/<route>`. React Native Web renders `testID` as `data-testid`, so select with `[data-testid="..."]`; `page.fill` on a TextInput testID triggers `onChangeText`.
- Each new browser context starts with empty storage, so data-dependent routes (jobs, previews) must be created through the UI in the same run.
- Web differs from iPhone on purpose: creating a quote on web shows Print/Copy instead of the share sheet, so the "Did it go out?" sheet and the one-time first-quote paywall never appear on web. Verify those on a device.
- The home sample-quote card only shows while there are no real jobs (or a sample already exists), so a test that creates jobs first will not find it.

**Why:** found while verifying the full build; the flows passed this way with zero console errors.
**How to apply:** use this before claiming an interactive flow works; keep screenshots at about 400x720.
