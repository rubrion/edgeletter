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

Already done (2026-11-16):
- **GitHub:** the `rubrion` App is installed org-wide; `AUTOMATION_APP_PRIVATE_KEY` secret and `AUTO_RELEASE=true` set on `rubrion/edgeletter`; baseline tag `app-v1.0.0`.
- **Worker:** `REVIEW_EMAIL` / `REVIEW_CODE` secrets set (also in Infisical, Edgeletter `prod:/worker`). The review account owns a demo publication, *Play Review* (`playreview`).
- **Web:** privacy policy at https://edgeletter.blog/privacy, deletion page at https://app.edgeletter.blog/delete-account.

Left to do:
1. **Play Console:** create the app `blog.edgeletter` and fill the forms with `store/play-console.md`. Give the Play service account (the one Codemagic's `rubry` group uses, or a new one) access to the app.
2. **Codemagic:** add `rubrion/edgeletter` as an app, create the env group `edgeletter` with `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS` (that service account's JSON), and run *EdgeLetter · Android · Google Play (AAB)* on `main`. The `rubrion-release` keystore is team-level already.
3. **First release:** Play needs the first bundle uploaded by hand. Download `app-release.aab` from that Codemagic run, upload it to Internal testing, then later runs publish by themselves.
4. **Stripe (recommended):** give the Worker's restricted key *Subscriptions: Write* so account deletion cancels Pro subscriptions itself. Until then, staff get an email to cancel them by hand.
