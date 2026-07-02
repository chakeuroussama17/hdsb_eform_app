# Push Notifications — Setup Guide

Native push notifications (system tray + sound, **even when the app is closed**):
- **HOS / HOD / HR / Finance admins** get pushed when a new request needs them.
- **Employees** get pushed when their request is approved or rejected.
- **HOD** gets pushed when HOS approves (it's now their turn).

All the code is already in the app. Four one-time steps remain — they need
your Google/Supabase accounts, so only you can do them (≈10 minutes total).

---

## Step 1 — Create a Firebase project (free)

Android push runs on Firebase Cloud Messaging (FCM); there is no alternative.

1. Go to https://console.firebase.google.com → **Add project** → name it
   `hdsb-eform` (Analytics: off is fine).
2. In the project: click the **Android icon** (Add app) and register with
   package name exactly: **`com.hdsb.eform`**
3. Download **`google-services.json`** and place it at:
   ```
   HDSB_EFORM_APP/android/app/google-services.json
   ```
4. Commit and push it (it's not a secret — safe to commit):
   ```bash
   git add android/app/google-services.json
   git commit -m "Add Firebase config for push notifications"
   git push
   ```
   This triggers CI to build a **new APK — reinstall it on the phones.**

## Step 2 — Get the Firebase service account key

1. Firebase console → ⚙️ **Project settings** → **Service accounts** tab
   → **Generate new private key** → a `.json` file downloads.
2. Supabase Dashboard → your project → **Edge Functions** → **Secrets**
   (or Project Settings → Edge Functions) → **Add secret**:
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Value: paste the **entire contents** of that JSON file.

## Step 3 — Deploy the `push-dispatch` edge function

From the `HDSB_EFORM_APP` folder:

```bash
npx supabase login                 # opens browser, one-time
npx supabase functions deploy push-dispatch --project-ref rfaikvgsulpbpsyfccku
```

(Alternative: Dashboard → Edge Functions → Deploy new function → name it
`push-dispatch` → paste `supabase/functions/push-dispatch/index.ts`.)

## Step 4 — Run the database setup SQL

Supabase Dashboard → **SQL Editor** → New query → paste the contents of
[`supabase/push_notifications_setup.sql`](supabase/push_notifications_setup.sql)
→ **Run**.

This creates the `device_tokens` table (with RLS) and a trigger that calls
`push-dispatch` whenever a submission is created or its status changes.

---

## Test it

1. Install the **new APK** (built after Step 1) on two phones.
2. Phone A: log in as an employee. Phone B: log in as the matching HOS/HOD
   (accept the notification permission prompt on first launch).
3. Phone A: submit a Pass Exit/leave form → **Phone B rings with a tray
   notification even if the app is closed.** Tap it → opens the approvals page.
4. Phone B: approve it → **Phone A gets "Approved ✅"** the same way.

## How it works

```
Form submitted / status changed (submissions table)
        │  database trigger (pg_net)
        ▼
push-dispatch edge function
        │  picks recipients (HOS/HOD by name, HR/Finance by form type,
        │  submitter on status change), reads their device_tokens
        ▼
Firebase Cloud Messaging ──▶ phone system tray + sound (app can be closed)
```

## Troubleshooting

- **No notification?** Check Edge Functions → push-dispatch → **Logs** in the
  Supabase dashboard — every send (or error) is logged there.
- **"FIREBASE_SERVICE_ACCOUNT secret is not set"** → redo Step 2.
- **Permission denied on the phone** → Android Settings → Apps → HDSB E-Form
  → Notifications → allow.
- Emulators need Google Play services; use a real phone to test.
