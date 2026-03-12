import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase.js";

/* ─── useMarkets ─────────────────────────────────────────────────── */
export function useMarkets(session, sendNotif) {
  const [markets, setMarkets]           = useState([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [settled, setSettled]           = useState(new Set());

  const loadMarkets = async () => {
    setMarketsLoading(true);
    const [
      { data: mData },
      { data: oData },
      { data: phData },
      { data: tData },
      { data: sdData },
    ] = await Promise.all([
      supabase.from("markets").select("*").order("created_at", { ascending: false }),
      supabase.from("orders").select("*"),
      supabase.from("price_history").select("*").order("ts", { ascending: true }),
      supabase.from("trades").select("*").order("ts", { ascending: false }),
      supabase.from("settled_debts").select("id"),
    ]);
    const assembled = (mData || []).map((m) => ({
      id: m.id, title: m.title, description: m.description, resolution: m.resolution,
      creator: m.creator_id, creatorName: m.creator_name,
      status: m.status, resolvedAs: m.resolved_as, resolvedNote: m.resolved_note,
      resolvedAt: m.resolved_at ? new Date(m.resolved_at).getTime() : null,
      createdAt: new Date(m.created_at).getTime(),
      hiddenFrom: m.hidden_from || [],
      orders: (oData || []).filter((o) => o.market_id === m.id).map((o) => ({
        id: o.id, side: o.side, price: o.price, size: parseFloat(o.size),
        userId: o.user_id, name: o.name,
      })),
      priceHistory: (phData || []).filter((p) => p.market_id === m.id).map((p) => ({ ts: p.ts, yes: p.yes })),
      trades: (tData || []).filter((t) => t.market_id === m.id).map((t) => ({
        price: t.price, side: t.side, buyer: t.buyer, seller: t.seller,
        size: parseFloat(t.size), ts: t.ts,
      })),
    }));
    const currentUserId = session?.user?.id;
    const visible = assembled.filter((m) =>
      !currentUserId || m.creator === currentUserId || !(m.hiddenFrom.includes(currentUserId))
    );
    setMarkets(visible);
    setSettled(new Set((sdData || []).map((s) => s.id)));
    setMarketsLoading(false);
  };

  useEffect(() => {
    if (!session) return;
    loadMarkets();

    // Real-time subscriptions — reload on any change
    const channel = supabase
      .channel("market-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "markets" }, loadMarkets)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, loadMarkets)
      .on("postgres_changes", { event: "*", schema: "public", table: "price_history" }, loadMarkets)
      .on("postgres_changes", { event: "*", schema: "public", table: "trades" }, loadMarkets)
      .on("postgres_changes", { event: "*", schema: "public", table: "settled_debts" }, loadMarkets)
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [session]);

  const addMarket = async (m) => {
    await supabase.from("markets").insert({
      id: m.id, title: m.title, description: m.description, resolution: m.resolution,
      creator_id: m.creator, creator_name: m.creatorName,
      status: "open", resolved_as: null, resolved_note: null,
      hidden_from: m.hiddenFrom || [],
    });
    if (m.orders.length > 0) {
      await supabase.from("orders").insert(m.orders.map((o) => ({
        id: o.id, market_id: m.id, side: o.side, price: o.price,
        size: o.size, user_id: o.userId, name: o.name,
      })));
    }
    if (m.priceHistory.length > 0) {
      await supabase.from("price_history").insert(m.priceHistory.map((p) => ({
        market_id: m.id, ts: p.ts, yes: p.yes,
      })));
    }
    sendNotif("new_market", { marketTitle: m.title, creatorName: m.creatorName, marketId: m.id, excludeUserIds: [m.creator] });
  };

  const updateMarket = async (updated) => {
    await supabase.from("markets").update({
      status: updated.status, resolved_as: updated.resolvedAs, resolved_note: updated.resolvedNote,
      resolved_at: updated.resolvedAt ? new Date(updated.resolvedAt).toISOString() : null,
    }).eq("id", updated.id);
    await supabase.from("orders").delete().eq("market_id", updated.id);
    if (updated.orders.length > 0) {
      await supabase.from("orders").insert(updated.orders.map((o) => ({
        id: o.id, market_id: updated.id, side: o.side, price: o.price,
        size: o.size, user_id: o.userId, name: o.name,
      })));
    }
    const { data: existing } = await supabase
      .from("price_history").select("ts").eq("market_id", updated.id);
    const existingTs = new Set((existing || []).map((p) => p.ts));
    const newPoints = updated.priceHistory.filter((p) => !existingTs.has(p.ts));
    if (newPoints.length > 0) {
      await supabase.from("price_history").insert(newPoints.map((p) => ({
        market_id: updated.id, ts: p.ts, yes: p.yes,
      })));
    }
    const { data: existingTrades } = await supabase
      .from("trades").select("ts, buyer, seller").eq("market_id", updated.id);
    const existingTradeKeys = new Set((existingTrades || []).map((t) => `${t.ts}-${t.buyer}-${t.seller}`));
    const newTrades = updated.trades.filter((t) => !existingTradeKeys.has(`${t.ts}-${t.buyer}-${t.seller}`));
    if (newTrades.length > 0) {
      await supabase.from("trades").insert(newTrades.map((t) => ({
        market_id: updated.id, price: t.price, side: t.side,
        buyer: t.buyer, seller: t.seller, size: t.size, ts: t.ts,
      })));
    }
  };

  const markSettled = async (key) => {
    await supabase.from("settled_debts").insert({ id: key, settled_by: session.user.id });
  };

  return { markets, marketsLoading, settled, addMarket, updateMarket, markSettled };
}
