import { useEffect, useState } from "react";

/* --------------------------------------------------------------------------
   Notification store — local-first event log surfaced by the bell icon.

   Records security & account events (login, password change, profile saved,
   subscription updates) so the user can audit what their account did even
   without an internet round-trip. Backed by localStorage and namespaced per
   user-id so logging out doesn't leak events across accounts.

   This is intentionally NOT a websocket / push channel. Server-pushed
   notifications can dispatch into the same store via `addNotification`.
   -------------------------------------------------------------------------- */

export type NotificationKind =
  | "login"
  | "password_change"
  | "password_revoke"
  | "profile_saved"
  | "subscription"
  | "security"
  | "info";

export type Notification = {
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  createdAt: number; // epoch ms
  readAt?: number;
};

const KEY_PREFIX = "pesalens.notifications";
const MAX_KEEP = 50;

const userKey = (userId?: string | number | null) =>
  `${KEY_PREFIX}:${userId ?? "anon"}`;

const safeRead = (key: string): Notification[] => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_KEEP);
  } catch {
    return [];
  }
};

const safeWrite = (key: string, items: Notification[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(items.slice(0, MAX_KEEP)));
    window.dispatchEvent(new CustomEvent("pesalens:notifications-changed"));
  } catch {
    /* quota exceeded — silently drop */
  }
};

let activeUserId: string | number | null = null;

/* Bind the store to the currently signed-in user so all reads/writes target
   the right namespace. Call after sign-in (and pass `null` on sign-out). */
export const setNotificationsUser = (userId: string | number | null) => {
  activeUserId = userId;
  window.dispatchEvent(new CustomEvent("pesalens:notifications-changed"));
};

export const listNotifications = (): Notification[] =>
  safeRead(userKey(activeUserId)).sort((a, b) => b.createdAt - a.createdAt);

export const unreadCount = (): number =>
  listNotifications().filter((n) => !n.readAt).length;

const newId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const addNotification = (input: {
  kind: NotificationKind;
  title: string;
  body?: string;
}): Notification => {
  const note: Notification = {
    id: newId(),
    kind: input.kind,
    title: input.title,
    body: input.body,
    createdAt: Date.now(),
  };
  const key = userKey(activeUserId);
  const next = [note, ...safeRead(key)];
  safeWrite(key, next);
  return note;
};

/* Map server AuditLog event codes → local notification kinds (icon/tone). */
const EVENT_KIND: Record<string, NotificationKind> = {
  signin_success: "login",
  email_verified_via_signin: "security",
  email_verified: "security",
  signup: "info",
  logout: "login",
  password_changed: "password_change",
  password_change_revoked: "password_revoke",
  password_reset: "password_change",
  data_export: "info",
  upload_succeeded: "info",
  upload_failed: "security",
  manual_payment_confirmed: "subscription",
  manual_payment_confirm_requested: "subscription",
};

/* Merge server-side activity (the timestamped audit trail from
   GET /auth/me/activity) into the local store. Server rows are keyed by a
   stable `srv-<id>` id so repeated syncs don't duplicate, and arrive
   pre-read (they're history, not fresh alerts). */
export const syncServerActivity = (
  activity: Array<{ id: number; event: string; title: string; created_at: string | null }>,
): void => {
  if (!Array.isArray(activity) || activity.length === 0) return;
  const key = userKey(activeUserId);
  const existing = safeRead(key);
  const existingIds = new Set(existing.map((n) => n.id));
  const now = Date.now();
  const mapped: Notification[] = [];
  for (const a of activity) {
    const id = `srv-${a.id}`;
    if (existingIds.has(id)) continue;
    const parsed = a.created_at ? Date.parse(a.created_at) : now;
    mapped.push({
      id,
      kind: EVENT_KIND[a.event] || "info",
      title: a.title || a.event,
      createdAt: Number.isNaN(parsed) ? now : parsed,
      readAt: now,
    });
  }
  if (!mapped.length) return;
  const merged = [...mapped, ...existing]
    .sort((x, y) => y.createdAt - x.createdAt)
    .slice(0, MAX_KEEP);
  safeWrite(key, merged);
};

export const markAllRead = () => {
  const key = userKey(activeUserId);
  const at = Date.now();
  const next = safeRead(key).map((n) => ({ ...n, readAt: n.readAt ?? at }));
  safeWrite(key, next);
};

export const dismissNotification = (id: string) => {
  const key = userKey(activeUserId);
  const next = safeRead(key).filter((n) => n.id !== id);
  safeWrite(key, next);
};

export const clearAllNotifications = () => {
  const key = userKey(activeUserId);
  safeWrite(key, []);
};

/* Subscribe-style hook for components. Re-renders whenever the store
   changes (cross-tab via storage event, in-tab via custom event). */
export const useNotifications = () => {
  const [items, setItems] = useState<Notification[]>(() => listNotifications());
  useEffect(() => {
    const sync = () => setItems(listNotifications());
    window.addEventListener("pesalens:notifications-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("pesalens:notifications-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return {
    items,
    unread: items.filter((n) => !n.readAt).length,
    markAllRead,
    dismiss: dismissNotification,
    clear: clearAllNotifications,
  };
};
