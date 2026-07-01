# HDSB E-Form — Mobile App (Android)

A native Android build of the [HDSB E-Form website](https://github.com/HDSB-E-Form/e-form-website),
packaged with **[Capacitor](https://capacitorjs.com/)**. It is the *same* React app and the
*same* Supabase backend, wrapped in a native shell and shipped as a downloadable `.apk`.

- Same UI, same pages, same login as the website.
- Same Supabase backend (auth, database, realtime notifications).
- Produces a real, installable `.apk`.

---

## How it works

```
React + Vite web app  ──build──▶  dist/  ──Capacitor──▶  android/  ──Gradle──▶  hdsb-eform.apk
```

The web app is built exactly as the website is, then Capacitor copies the built assets into a
native Android project and Gradle compiles the APK.

---

## 1. Configure the Supabase backend

The app reads the backend URL/key at build time. Copy the example env file and fill in the
**same** values the website uses:

```bash
cp .env.example .env
```

```env
VITE_SUPABASE_URL=https://YOUR-PROJECT-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

> `.env` is git-ignored — your keys are never committed. For the cloud build (below), the same
> two values are stored as GitHub **Secrets**.

---

## 2. Build the APK in the cloud (recommended — no Android tools needed)

A GitHub Actions workflow (`.github/workflows/build-apk.yml`) builds the APK for you.

1. Push this folder to its **own** GitHub repository (it must be the repo root so the workflow
   at `.github/workflows/` is detected).
2. In the repo, go to **Settings → Secrets and variables → Actions → New repository secret** and
   add both:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Go to the **Actions** tab → **Build Android APK** → **Run workflow** (it also runs on every push).
4. When it finishes, open the run and download **`hdsb-eform-apk`** from the **Artifacts** section.
   Unzip it to get `hdsb-eform.apk`.

**Permanent download link:** push a git tag (e.g. `git tag v1.0.0 && git push origin v1.0.0`) and the
APK is automatically attached to a **GitHub Release**.

---

## 3. Install on a phone

1. Copy `hdsb-eform.apk` to the Android device (or download it there).
2. Enable **Install from unknown sources** for your browser/file manager.
3. Tap the APK to install. Open **HDSB E-Form** and log in with your normal account.

> This is a **debug-signed** APK — perfect for internal testing/distribution. For the Google Play
> Store you'll need a release build signed with your own keystore (see "Release signing" below).

---

## 4. Build locally (optional — needs Android tooling)

Requires **JDK 17** and the **Android SDK**.

```bash
npm install
npm run build            # build the web assets into dist/
npx cap sync android     # copy assets + plugins into the android project
cd android
./gradlew assembleDebug  # -> android/app/build/outputs/apk/debug/app-debug.apk
```

Open in Android Studio instead with: `npx cap open android`.

---

## Release signing (for Play Store, later)

1. Create a keystore: `keytool -genkey -v -keystore hdsb.keystore -alias hdsb -keyalg RSA -keysize 2048 -validity 10000`
2. Configure signing in `android/app/build.gradle`.
3. Build with `./gradlew assembleRelease` (or add a signed-release step + secrets to the workflow).

---

## Project layout

| Path | Purpose |
|------|---------|
| `src/` | The React app (identical to the website). |
| `capacitor.config.ts` | Capacitor config — app id `com.hdsb.eform`, name **HDSB E-Form**. |
| `android/` | Generated native Android project (committed so CI can build it). |
| `.github/workflows/build-apk.yml` | Cloud APK build. |
| `.env` / `.env.example` | Supabase credentials (build-time). |

## Updating the app after website changes

Re-copy the website `src/` (and assets), then:

```bash
npm run build && npx cap sync android
```

Then rebuild the APK (push to trigger CI, or `./gradlew assembleDebug` locally).
