import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const SUPABASE_URL  = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE;
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@willdoug.irish";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const NOTIFICATION_MESSAGES = {
  new_signup:        (p) => ({ title: "New member ☘️",            body: `${p.userName} just joined.` }),
  new_market:        (p) => ({ title: "New market 📈",             body: `${p.creatorName}: "${p.marketTitle}"` }),
  any_fill:          (p) => ({ title: "Trade executed ⚡",         body: `${p.buyerName} & ${p.sellerName} traded $${p.size} @ ${p.price}¢ on "${p.marketTitle}"` }),
  your_market_order: (p) => ({ title: "Order in your market",      body: `${p.orderName} placed $${p.size} on "${p.marketTitle}"` }),
  market_resolved:   (p) => ({ title: "Market resolved 🏁",        body: `"${p.marketTitle}" resolved ${p.resolvedAs}` }),
  own_fill:          (p) => ({ title: "Your order filled ⚡",      body: `$${p.size} filled @ ${p.price}¢ on "${p.marketTitle}"` }),
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: "Unauthorized" });

  const { type, payload } = req.body;
  if (!type || !NOTIFICATION_MESSAGES[type]) return res.status(400).json({ error: "invalid type" });

  // Determine which users to notify
  let targetUserIds = new Set();

  const { data: allPrefs } = await admin.from("notification_preferences").select("user_id, " + type).eq(type, true);
  const interestedUserIds = new Set((allPrefs || []).map((p) => p.user_id));

  if (type === "your_market_order" || type === "market_resolved") {
    // Notify users who are participants in this market (created it or placed orders)
    const { data: ordUsers } = await admin.from("orders").select("user_id").eq("market_id", payload.marketId);
    const marketParticipants = new Set((ordUsers || []).map((o) => o.user_id).filter(Boolean));
    if (payload.participantUserIds) {
      for (const uid of payload.participantUserIds) marketParticipants.add(uid);
    }
    for (const uid of interestedUserIds) {
      if (marketParticipants.has(uid)) targetUserIds.add(uid);
    }
  } else if (type === "own_fill") {
    // Only notify specific users whose resting orders were filled
    for (const uid of (payload.filledUserIds || [])) {
      if (interestedUserIds.has(uid)) targetUserIds.add(uid);
    }
  } else {
    // Global events: notify all opted-in users
    for (const uid of interestedUserIds) targetUserIds.add(uid);
  }

  // Always exclude users specified in excludeUserIds (the action's trigger)
  for (const uid of (payload.excludeUserIds || [])) targetUserIds.delete(uid);
  // Also always exclude the requesting user
  targetUserIds.delete(user.id);

  if (targetUserIds.size === 0) return res.status(200).json({ sent: 0 });

  // Load subscriptions for target users
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("user_id, subscription")
    .in("user_id", [...targetUserIds]);

  if (!subs || subs.length === 0) return res.status(200).json({ sent: 0 });

  const msg = NOTIFICATION_MESSAGES[type](payload);

  let sent = 0;
  const staleIds = [];

  await Promise.all(subs.map(async ({ user_id, subscription }) => {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(msg));
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
