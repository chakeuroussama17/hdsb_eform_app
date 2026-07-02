// push-dispatch — sends native push notifications (FCM) for form events.
//
// Called by a database trigger (pg_net) whenever a row in `submissions` is
// INSERTed (new request → notify approvers) or its status is UPDATEd
// (approved/rejected → notify the submitter; HOS-approved → notify the HOD).
//
// Required secret (Project Settings → Edge Functions → Secrets):
//   FIREBASE_SERVICE_ACCOUNT — full JSON of a Firebase service account key
//
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ── FCM auth: mint an OAuth2 access token from the service account ────────
let cachedToken: { value: string; exp: number } | null = null;

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function getFcmAccessToken(sa: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.value;

  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(enc.encode(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })));
  const input = `${header}.${claims}`;

  const key = await crypto.subtle.importKey(
    "pkcs8", pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(input)));
  const jwt = `${input}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!res.ok) throw new Error("OAuth token error: " + JSON.stringify(data));
  cachedToken = { value: data.access_token, exp: now + 3500 };
  return data.access_token;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const EXCLUDED_FORMS = [
  "inventory_addition", "ppe_request", "waste_inventory",
  "mixing_chemical_stages", "final_discharge", "daily_operation_monitoring",
];

function formLabel(formType: string): string {
  if (formType === "leave") return "Pass Exit";
  return (formType || "form").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusLabel(status: string): string {
  switch (status) {
    case "approved":
    case "approved_hod": return "Approved ✅";
    case "rejected": return "Rejected ❌";
    case "approved_hos": return "Approved by HOS — pending HOD";
    case "approved_hop": return "Approved by HOP";
    case "approved_hof": return "Approved by HOF";
    case "pending": return "Pending";
    default: return (status || "").replace(/_/g, " ");
  }
}

interface PushTarget { userId: string; title: string; body: string; url: string }

async function sendToTargets(targets: PushTarget[], saJson: string) {
  if (targets.length === 0) return { sent: 0 };
  const sa = JSON.parse(saJson);
  const accessToken = await getFcmAccessToken(sa);
  const fcmUrl = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

  const userIds = [...new Set(targets.map((t) => t.userId))];
  const { data: tokens, error } = await supabase
    .from("device_tokens").select("user_id, token").in("user_id", userIds);
  if (error) throw error;

  let sent = 0;
  const staleTokens: string[] = [];

  for (const t of targets) {
    const deviceTokens = (tokens ?? []).filter((row) => row.user_id === t.userId);
    for (const { token } of deviceTokens) {
      const res = await fetch(fcmUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: t.title, body: t.body },
            data: { url: t.url },
            android: {
              priority: "HIGH",
              notification: {
                channel_id: "eform_alerts",
                sound: "default",
                default_vibrate_timings: true,
              },
            },
          },
        }),
      });
      if (res.ok) {
        sent++;
      } else {
        const err = await res.json().catch(() => ({}));
        const code = err?.error?.details?.[0]?.errorCode || err?.error?.status;
        console.error("FCM send failed:", res.status, JSON.stringify(err?.error?.message || err));
        // Remove tokens for uninstalled / expired app instances
        if (res.status === 404 || code === "UNREGISTERED" || code === "NOT_FOUND") {
          staleTokens.push(token);
        }
      }
    }
  }

  if (staleTokens.length > 0) {
    await supabase.from("device_tokens").delete().in("token", staleTokens);
  }
  return { sent };
}

// ── Main handler ───────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const saJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
    if (!saJson) throw new Error("FIREBASE_SERVICE_ACCOUNT secret is not set");

    const payload = await req.json();
    const type: string = payload.type; // 'INSERT' | 'UPDATE'
    const rec = payload.record ?? {};
    const old = payload.old_record ?? {};

    const formType: string = rec.formType || "";
    const employeeName: string = rec.employeeName || "An employee";
    const data = rec.data || {};
    const targets: PushTarget[] = [];

    if (type === "INSERT") {
      if (EXCLUDED_FORMS.includes(formType)) {
        return Response.json({ skipped: "excluded form type" });
      }

      // Mirror the in-app notification rules: HOS/HOD by selected name,
      // HR admin for leave & car rental, Finance admin for claims.
      const orFilters: string[] = [];
      if (data.hosName) orFilters.push(`and(role.eq.hos,name.eq."${data.hosName}")`);
      if (data.hodName) orFilters.push(`and(role.eq.hod,name.eq."${data.hodName}")`);
      if (["leave", "car_rental"].includes(formType)) orFilters.push("role.eq.hr_admin");
      if (formType === "claim") orFilters.push("role.eq.finance_admin");

      if (orFilters.length > 0) {
        const { data: recipients, error } = await supabase
          .from("users").select("id, role").or(orFilters.join(","));
        if (error) throw error;

        const title = `New ${formLabel(formType)} request`;
        for (const r of recipients ?? []) {
          if (r.id === rec.submittedBy) continue; // don't notify the submitter
          const url = ["hos", "hod"].includes(r.role) ? "/admin/approvals"
            : r.role === "finance_admin" ? "/admin/finance"
            : r.role === "hr_admin" ? "/admin/hr" : "/home";
          targets.push({ userId: r.id, title, body: `${employeeName} submitted a new form.`, url });
        }
      }
    } else if (type === "UPDATE") {
      if (rec.status === old.status) return Response.json({ skipped: "status unchanged" });

      // 1) Tell the submitter their request moved
      if (rec.submittedBy) {
        targets.push({
          userId: rec.submittedBy,
          title: `${formLabel(formType)} request: ${statusLabel(rec.status)}`,
          body: `Your ${formLabel(formType).toLowerCase()} request has been updated.`,
          url: "/submissions",
        });
      }

      // 2) HOS approved → it's now the HOD's turn
      if (rec.status === "approved_hos" && data.hodName) {
        const { data: hods } = await supabase
          .from("users").select("id").eq("role", "hod").eq("name", data.hodName);
        for (const h of hods ?? []) {
          targets.push({
            userId: h.id,
            title: `${formLabel(formType)} awaiting your approval`,
            body: `${employeeName}'s request was approved by HOS and needs your review.`,
            url: "/admin/approvals",
          });
        }
      }
    }

    const result = await sendToTargets(targets, saJson);
    return Response.json({ ok: true, targets: targets.length, ...result });
  } catch (e) {
    console.error("push-dispatch error:", e);
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
});
