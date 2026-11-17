# EdgeLetter for Android

A Capacitor shell around the Studio at **app.edgeletter.blog**, so the app updates with every web deploy. A new store build is needed only when `mobile/` changes (icons, permissions, Capacitor version).

- **App id:** `blog.edgeletter`. It is permanent once the app is on Play.
- **What loads inside:** only `app.edgeletter.blog` and Cloudflare's bot check (`challenges.cloudflare.com`). The landing page, public blogs and every other link open in the system browser. Offline, the app shows `www/offline.html`.
- **Permissions:** `INTERNET` only.

## How the web app treats the app

The shell appends `EdgeLetterApp` to the WebView user agent (`capacitor.config.ts`). The web app reads it in `src/lib/native.ts` and sets `Astro.locals.inApp`, then:

- **No purchases.** Google Play only allows digital purchases through Play Billing, which EdgeLetter doesn't use. So the app has no "Plan" item in the menu. `/billing` redirects to the overview and `/api/billing/*` returns 403. Upgrade links (dashboard tile, custom domain page, watermark hint, the email-limit error) are replaced with neutral text.
- **Sign-in by code.** Google blocks OAuth inside WebViews, so the Google button is hidden. The sign-in email carries both a link (for browsers) and a 6-digit code, and the app shows a field to type the code. Tapping the link on the phone would open the system browser and leave the session there.
- **Edge to edge.** The page uses `viewport-fit=cover`, and the top bar and drawer pad for the safe-area insets.

## Setup

```sh
cd mobile
bun install
bun run assets         # icons + splash from assets/ (after changing them)
bunx cap sync android  # after any change to capacitor.config.ts
```

The artwork in `assets/` and `store/` is rendered from the brand mark with `bun mobile/scripts/render-sources.ts`, run from the repo root (it uses the root project's sharp).

## Local build

You need JDK 21 and Android SDK platform 36. Write `sdk.dir=/path/to/Android/Sdk` into `android/local.properties`, then:

```sh
JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 bun run apk:debug
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## Releases

- **Version name.** `.github/workflows/release.yml` bumps `package.json` from Conventional Commits that touch `mobile/` (`feat` gives a minor bump, `fix`/`perf` a patch) and tags `app-vX.Y.Z`. It uses the shared engine in `rubrion/.github`.
- **Build and publish.** `codemagic.yaml` at the repo root builds the signed AAB and publishes it with `fastlane supply`. You start builds by hand in Codemagic.
  - A build of any branch other than `production` goes to the **internal** track.
  - A build of the `production` branch goes to the **production** track. Move `production` forward with `gh workflow run promote`.
- **Release notes.** Edit `store/whatsnew/en-US.txt` and `pt-BR.txt` (500 characters max each) before each store build.

### One-time setup

1. **GitHub:**
   - Install the `rubrion` GitHub App (id 1117691, Contents: read & write) on `rubrion/edgeletter`.
   - Set the secret and variable:
     ```sh
     infisical secrets get AUTOMATION_APP_PRIVATE_KEY --projectId 4dbb5673-ad94-406d-9363-4634c8763afa --env prod --path /github-app --plain --silent --domain https://infisical.rubrion.ai/api | gh secret set AUTOMATION_APP_PRIVATE_KEY -R rubrion/edgeletter
     gh variable set AUTO_RELEASE --body true -R rubrion/edgeletter
     ```
2. **Codemagic:**
   - Add the repo as an app.
   - Create the env group `edgeletter` with `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS` (the Play service-account JSON, granted access to `blog.edgeletter`).
   - The `rubrion-release` keystore is already team-level.
3. **Worker secrets** for Play review (reviewers can't receive our email). Keep them in Infisical too.
   ```sh
   wrangler secret put REVIEW_EMAIL   # e.g. a review@ address; create its publication first
   wrangler secret put REVIEW_CODE    # at least 6 digits
   ```
4. **Play Console** (app `blog.edgeletter`):
   - **Privacy policy URL.**
   - **App access:** reviewer instructions. Enter `REVIEW_EMAIL`, press send, then type `REVIEW_CODE`.
   - **Data safety:** email address, the content users write, and subscriber emails they import.
   - **Account deletion URL:** `https://app.edgeletter.blog/delete-account`. Deletion itself is in the app under **Account**.
   - **Store listing:** title, descriptions, `store/icon-512.png`, `store/feature-1024x500.png`, and phone screenshots taken from the app (1080×1920).
   - **First production release:** upload the AAB artifact by hand as a draft once. After that, the scripted releases work.
