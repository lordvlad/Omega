/**
 * Browser notifications for agent yield events.
 *
 * Dispatches Web Notifications when a turn completes, fails, or pauses for
 * plan approval while the tab is inactive or in the background.
 */

export interface BrowserNotificationOptions {
  title: string;
  body?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
  onClick?: () => void;
}

/** Check if Web Notifications API is supported in this browser environment. */
export function isNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Current permission status for Web Notifications. */
export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (!isNotificationSupported()) {
    return "unsupported";
  }
  return Notification.permission;
}

/** Request permission for Web Notifications if not already determined. */
export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!isNotificationSupported()) {
    return "unsupported";
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/**
 * Dispatch a native browser notification if permission is granted.
 * Focuses the tab/window when clicked.
 */
export async function showYieldNotification(options: BrowserNotificationOptions): Promise<Notification | null> {
  if (!isNotificationSupported() || Notification.permission !== "granted") {
    return null;
  }

  const icon = options.icon ?? "/icon-192.png";
  const badge = options.badge ?? "/icon-192.png";

  try {
    if (typeof Notification === "function") {
      try {
        const notification = new Notification(options.title, {
          body: options.body,
          icon,
          badge,
          tag: options.tag,
        });

        notification.onclick = () => {
          window.focus();
          options.onClick?.();
          notification.close();
        };

        return notification;
      } catch {
        // Some mobile browsers (e.g. Android Chrome) throw and require registration.showNotification
      }
    }

    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if (reg && "showNotification" in reg) {
        await reg.showNotification(options.title, {
          body: options.body,
          icon,
          badge,
          tag: options.tag,
          data: options.data,
        });
      }
    }
  } catch (error) {
    console.warn("[omega] failed to show browser notification:", error);
  }

  return null;
}
