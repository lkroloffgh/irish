import { verifyUser } from "../_utils.js";
import webpush from "web-push";

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@willdoug.irish";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

// One message builder per preference type
const MESSAGES = {
  own_fill:            (p) => ({ title: "Your order filled ⚡",    body: `$${p.filledSize} filled @ ${p.price}¢ on "${p.marketTitle}"` }),
  your_market_order:   (p) => ({ title: "Order in your market",    body: `${p.orderName} placed $${p.size} on "${p.marketTitle}"` }),
  any_fill:            (p) => ({ title: "Trade executed ⚡",        body: `$${p.filledSize} traded @ ${p.price}¢ on "${p.marketTitle}"` }),
  market_resolved:     (p) => ({ title: "Your market resolved 🏁", body: `"${p.marketTitle}" resolved ${p.resolvedAs}` }),
  any_market_resolved: (p) => ({ title: "Market resolved 🏁",      body: `"${p.marketTitle}" resolved ${p.resolvedAs}` }),
  new_market:          (p) => ({ title: "New market 📈",            body: `${p.creatorName}: "${p.marketTitle}"` }),
  new_signup:          (p) => ({ title: "New member ☘️",           body: `${p.userName} just joined.` }),
};

// Fetch all user preference rows for the given columns in one query
async function getPrefs(admin, cols) {
  const { data } = await admin.from("notification_preferences").select(["user_id", ...cols].join(", "));
  return data || [];
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const result = await verifyUser(req);
  if (!result) return res.status(401).json({ error: "Unauthorized" });
  const { user, admin } = result;

  const { event, payload } = req.body;
  if (!event || !payload) return res.status(400).json({ error: "event and payload required" });

  // Always exclude the triggering user + any explicitly excluded IDs
  const excludeIds = new Set([user.id, ...(payload.excludeUserIds || [])]);

  // userId → notification message (one per user, highest priority wins)
  const toSend = new Map();

  if (event === "order_confirmed") {
    const filledSize = payload.filledSize || 0;
    const filledSet = new Set(payload.filledUserIds || []);

    // Build full participant set: client-supplied + current open orders in DB
    const participantSet = new Set(payload.participantUserIds || []);
    if (payload.marketId) {
      const { data: dbOrdUsers } = await admin.from("orders").select("user_id").eq("market_id", payload.marketId);
      (dbOrdUsers || []).forEach((o) => { if (o.user_id) participantSet.add(o.user_id); });
    }

    const prefCols = ["own_fill", "your_market_order", ...(filledSize > 0 ? ["any_fill"] : [])];
    const prefs = await getPrefs(admin, prefCols);

    for (const p of prefs) {
      const uid = p.user_id;
      if (excludeIds.has(uid)) continue;

      // Priority 1: own_fill — resting order holder, only if something actually filled
      if (filledSize > 0 && filledSet.has(uid) && p.own_fill) {
        toSend.set(uid, MESSAGES.own_fill(payload));
      }
      // Priority 2: your_market_order — participant in this market
      else if (participantSet.has(uid) && p.your_market_order) {
        toSend.set(uid, MESSAGES.your_market_order(payload));
      }
      // Priority 3: any_fill — global, only if something actually filled
      else if (filledSize > 0 && p.any_fill) {
        toSend.set(uid, MESSAGES.any_fill(payload));
      }
    }

  } else if (event === "market_resolved") {
    const participantSet = new Set(payload.participantUserIds || []);
    if (payload.marketId) {
      const { data: dbOrdUsers } = await admin.from("orders").select("user_id").eq("market_id", payload.marketId);
      (dbOrdUsers || []).forEach((o) => { if (o.user_id) participantSet.add(o.user_id); });
    }

    const prefs = await getPrefs(admin, ["market_resolved", "any_market_resolved"]);

    for (const p of prefs) {
      const uid = p.user_id;
      if (excludeIds.has(uid)) continue;

      // Priority 1: market_resolved — you're a participant
      if (participantSet.has(uid) && p.market_resolved) {
        toSend.set(uid, MESSAGES.market_resolved(payload));
      }
      // Priority 2: any_market_resolved — global
      else if (p.any_market_resolved) {
        toSend.set(uid, MESSAGES.any_market_resolved(payload));
      }
    }

  } else if (event === "new_market") {
    const prefs = await getPrefs(admin, ["new_market"]);
    for (const p of prefs) {
      const uid = p.user_id;
      if (excludeIds.has(uid)) continue;
      if (p.new_market) toSend.set(uid, MESSAGES.new_market(payload));
    }

  } else if (event === "new_signup") {
    const prefs = await getPrefs(admin, ["new_signup"]);
    for (const p of prefs) {
      const uid = p.user_id;
      if (excludeIds.has(uid)) continue;
      if (p.new_signup) toSend.set(uid, MESSAGES.new_signup(payload));
    }

  } else {
    return res.status(400).json({ error: "invalid event" });
  }

  if (toSend.size === 0) return res.status(200).json({ sent: 0 });

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("user_id, subscription")
    .in("user_id", [...toSend.keys()]);

  if (!subs || subs.length === 0) return res.status(200).json({ sent: 0 });

  let sent = 0;
  const staleIds = [];

  await Promise.all(subs.map(async ({ user_id, subscription }) => {
    const msg = toSend.get(user_id);
    if (!msg) return;
    try {
      await webpush.sendNotification(subscription, JSON.stringify(msg), { TTL: 43200 });
      sent++;
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) staleIds.push(user_id);
    }
  }));

  if (staleIds.length > 0) {
    await admin.from("push_subscriptions").delete().in("user_id", staleIds);
  }

  return res.status(200).json({ sent });
}
