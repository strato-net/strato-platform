// Notification center: a persisted list of wallet notifications plus the
// machinery to surface them as OS notifications (chrome.notifications) and a
// toolbar unread badge. Watchers (see watchers.ts) call pushNotification() when
// they detect an event; the popup reads the list via control methods.

import { storage } from "wxt/storage";

export type NotifType = "bridge" | "incoming" | "loan";

export interface WalletNotification {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
  /** Optional in-popup route to open when the notification is clicked. */
  route?: string;
  /** Account this notification is about (clicking selects it). */
  address?: string;
}

export interface NotifSettings {
  /** Master switch for OS/desktop notifications (the in-app list is always kept). */
  os: boolean;
  bridge: boolean;
  incoming: boolean;
  loan: boolean;
}

const DEFAULT_SETTINGS: NotifSettings = { os: true, bridge: true, incoming: true, loan: true };
const MAX_NOTIFICATIONS = 50;

const listStore = storage.defineItem<WalletNotification[]>("local:notifications", {
  fallback: [],
});
const settingsStore = storage.defineItem<NotifSettings>("local:notifSettings", {
  fallback: DEFAULT_SETTINGS,
});

export async function getNotifSettings(): Promise<NotifSettings> {
  return { ...DEFAULT_SETTINGS, ...(await settingsStore.getValue()) };
}

export async function setNotifSettings(patch: Partial<NotifSettings>): Promise<NotifSettings> {
  const next = { ...(await getNotifSettings()), ...patch };
  await settingsStore.setValue(next);
  return next;
}

export async function listNotifications(): Promise<WalletNotification[]> {
  return listStore.getValue();
}

export async function unreadCount(): Promise<number> {
  return (await listStore.getValue()).filter((n) => !n.read).length;
}

export async function markRead(id: string): Promise<void> {
  const all = await listStore.getValue();
  const n = all.find((x) => x.id === id);
  if (n && !n.read) {
    n.read = true;
    await listStore.setValue(all);
    await refreshBadge();
  }
}

export async function markAllRead(): Promise<void> {
  const all = await listStore.getValue();
  let changed = false;
  for (const n of all) if (!n.read) ((n.read = true), (changed = true));
  if (changed) await listStore.setValue(all);
  await refreshBadge();
}

export async function clearNotifications(): Promise<void> {
  await listStore.setValue([]);
  await refreshBadge();
}

/**
 * Record a notification: prepend to the persisted list, fire an OS notification
 * (when enabled for its type), and update the unread badge. `idSeed` keeps the
 * notification id deterministic so a watcher can't double-record the same event.
 */
export async function pushNotification(
  n: Omit<WalletNotification, "id" | "createdAt" | "read">,
  idSeed: string
): Promise<void> {
  const settings = await getNotifSettings();
  if (settings[n.type] === false) return; // type muted entirely

  const id = `${n.type}:${idSeed}`;
  const all = await listStore.getValue();
  if (all.some((x) => x.id === id)) return; // already recorded

  const notif: WalletNotification = { ...n, id, createdAt: Date.now(), read: false };
  const next = [notif, ...all].slice(0, MAX_NOTIFICATIONS);
  await listStore.setValue(next);
  await refreshBadge();

  if (settings.os) await fireOsNotification(notif);
}

async function fireOsNotification(n: WalletNotification): Promise<void> {
  if (!browser.notifications?.create) {
    console.warn("[notifications] chrome.notifications unavailable (permission?)");
    return;
  }
  try {
    const createdId = await browser.notifications.create(n.id, {
      type: "basic",
      iconUrl: browser.runtime.getURL("/icon/128.png"),
      title: n.title,
      message: n.body,
      priority: n.type === "loan" ? 2 : 1,
    });
    console.debug("[notifications] OS notification shown:", createdId, n.title);
  } catch (e) {
    // Surfaced (not swallowed) so a misconfigured icon / OS suppression is visible
    // in the service-worker console.
    console.error("[notifications] OS notification failed:", e);
  }
}

/** Sync the toolbar badge to the current unread count. */
export async function refreshBadge(): Promise<void> {
  try {
    const count = await unreadCount();
    await browser.action?.setBadgeBackgroundColor?.({ color: "#001B70" });
    await browser.action?.setBadgeText?.({ text: count > 0 ? String(Math.min(count, 99)) : "" });
  } catch {
    /* action API unavailable */
  }
}
