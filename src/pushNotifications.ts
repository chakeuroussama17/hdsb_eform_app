import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "@/supabase";

const TOKEN_STORAGE_KEY = "push_token";

/**
 * Register this device for native push notifications (FCM) and store its
 * token in the `device_tokens` table so the push-dispatch edge function can
 * reach this user. Safe to call multiple times; no-ops on web, and never
 * throws (e.g. when google-services.json is missing or Play Services absent).
 */
export async function initPushNotifications(userId: string) {
  if (!Capacitor.isNativePlatform()) return;

  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt") {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== "granted") {
      console.warn("Push permission not granted");
      return;
    }

    // High-importance channel: heads-up banner + system default sound,
    // works even when the app is closed (Android 8+).
    await PushNotifications.createChannel({
      id: "eform_alerts",
      name: "E-Form Alerts",
      description: "New form requests and approval updates",
      importance: 5,
      visibility: 1,
      vibration: true,
    });

    await PushNotifications.removeAllListeners();

    PushNotifications.addListener("registration", async ({ value: token }) => {
      try {
        localStorage.setItem(TOKEN_STORAGE_KEY, token);
        await supabase.from("device_tokens").upsert(
          {
            user_id: userId,
            token,
            platform: Capacitor.getPlatform(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "token" }
        );
      } catch (e) {
        console.error("Failed to save push token:", e);
      }
    });

    PushNotifications.addListener("registrationError", (err) => {
      console.error("Push registration error:", err);
    });

    // User tapped the notification in the system tray → deep-link into the app.
    PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      const url = action.notification.data?.url;
      if (url && typeof url === "string" && url.startsWith("/")) {
        window.location.assign(url);
      }
    });

    await PushNotifications.register();
  } catch (e) {
    // Firebase not configured yet (no google-services.json) or no Play
    // Services — the rest of the app must keep working normally.
    console.warn("Push notifications unavailable:", e);
  }
}

/** Remove this device's token on logout so the user stops receiving pushes. */
export async function removePushToken() {
  try {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (token) {
      await supabase.from("device_tokens").delete().eq("token", token);
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch (e) {
    console.warn("Failed to remove push token:", e);
  }
}
