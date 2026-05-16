import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Inbox,
  KeyRound,
  LogIn,
  Sparkles,
  UserCog,
  X,
} from "lucide-react";
import {
  type Notification,
  clearAllNotifications,
  dismissNotification,
  markAllRead,
  useNotifications,
} from "@/data/notifications";

/* --------------------------------------------------------------------------
   NotificationsSheet — bottom-sheet panel anchored to the bell icon.

   Design contract: glassy backdrop, spring entry from bottom, drag-handle,
   typed icons per event kind. Renders the full event log with a clear-all
   action and per-item dismiss. Marks everything read on open so the unread
   pill resets automatically.
   -------------------------------------------------------------------------- */

const ICONS: Record<Notification["kind"], { Icon: any; tone: string }> = {
  login:           { Icon: LogIn,        tone: "bg-inc/15 text-inc" },
  password_change: { Icon: KeyRound,     tone: "bg-accent/15 text-accent" },
  password_revoke: { Icon: AlertTriangle,tone: "bg-dng/15 text-dng" },
  profile_saved:   { Icon: UserCog,      tone: "bg-net/15 text-net" },
  subscription:    { Icon: Sparkles,     tone: "bg-exp/15 text-exp" },
  security:        { Icon: AlertTriangle,tone: "bg-dng/15 text-dng" },
  info:            { Icon: CheckCircle2, tone: "bg-accent/15 text-accent" },
};

/* Friendly relative timestamp — "just now", "12m ago", "3h ago", date. */
const ago = (ts: number): string => {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
};

export const NotificationsSheet = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) => {
  const reduce = useReducedMotion();
  const { items } = useNotifications();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" />
          <motion.div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-[440px] glass-pane rounded-t-3xl border-t max-h-[85vh] overflow-hidden flex flex-col pb-safe shadow-2xl"
            initial={reduce ? { y: 0 } : { y: "100%" }}
            animate={{ y: 0 }}
            exit={reduce ? { y: 0 } : { y: "100%" }}
            transition={{ type: "spring", stiffness: 280, damping: 32 }}
          >
            {/* Drag handle */}
            <div className="pt-2 pb-1 flex justify-center shrink-0">
              <span className="block w-9 h-1 rounded-full bg-surface-4" />
            </div>

            {/* Header */}
            <div className="px-5 pt-2 pb-3 flex items-center justify-between border-b border-border/40 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-9 h-9 rounded-xl bg-accent/15 text-accent flex items-center justify-center shrink-0">
                  <Bell className="w-4.5 h-4.5" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-[16px] font-bold tracking-tight truncate" data-no-translate>
                    Notifications
                  </h3>
                  <p className="text-[11px] text-txt-3 font-mono-tab uppercase tracking-wider">
                    {items.length} {items.length === 1 ? "event" : "events"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {items.length > 0 && (
                  <button
                    onClick={() => clearAllNotifications()}
                    className="text-[11px] font-semibold text-txt-3 hover:text-txt-1 px-2.5 py-1.5 rounded-md ios-press"
                  >
                    Clear all
                  </button>
                )}
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="w-9 h-9 rounded-full bg-surface-3 flex items-center justify-center text-txt-2 active:bg-surface-4 ios-press"
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto scroll-hide scroll-smooth-y">
              {items.length === 0 ? (
                <div className="px-5 py-12 flex flex-col items-center text-center">
                  <div className="w-14 h-14 rounded-2xl bg-surface-3 flex items-center justify-center mb-3">
                    <Inbox className="w-6 h-6 text-txt-3" />
                  </div>
                  <h4 className="text-[15px] font-semibold text-txt-1">No notifications yet</h4>
                  <p className="text-[12px] text-txt-3 mt-1.5 max-w-[260px]">
                    Sign-ins, password changes and account events will land here.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border/40">
                  {items.map((n, i) => {
                    const { Icon, tone } = ICONS[n.kind] || ICONS.info;
                    return (
                      <motion.li
                        key={n.id}
                        initial={reduce ? false : { opacity: 0, y: 6 }}
                        animate={reduce ? undefined : { opacity: 1, y: 0 }}
                        transition={
                          reduce ? undefined : { delay: Math.min(i * 0.02, 0.15) }
                        }
                        className={`px-5 py-3.5 flex gap-3 items-start ${
                          n.readAt ? "" : "bg-accent/5"
                        }`}
                      >
                        <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tone}`}>
                          <Icon className="w-4.5 h-4.5" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-[13.5px] font-semibold text-foreground truncate">
                              {n.title}
                            </span>
                            <span className="text-[11px] text-txt-3 font-mono-tab shrink-0" data-no-translate>
                              {ago(n.createdAt)}
                            </span>
                          </div>
                          {n.body && (
                            <p className="text-[12.5px] text-txt-2 mt-1 leading-relaxed">
                              {n.body}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => dismissNotification(n.id)}
                          aria-label="Dismiss"
                          className="w-7 h-7 rounded-full text-txt-3 hover:text-txt-1 hover:bg-surface-3 flex items-center justify-center shrink-0 ios-press"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </motion.li>
                    );
                  })}
                </ul>
              )}
            </div>

            {items.length > 0 && (
              <div className="px-5 py-3 border-t border-border/40 shrink-0">
                <button
                  onClick={() => markAllRead()}
                  className="w-full text-[12px] font-semibold text-accent hover:text-accent/80 ios-press"
                >
                  Mark all as read
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
