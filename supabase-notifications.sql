-- Run these in your Supabase SQL editor to enable push notifications

-- Push subscriptions (one per user — upserted on every browser registration)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription JSONB NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own subscription"
  ON push_subscriptions FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Notification preferences (one row per user)
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  new_signup        BOOLEAN DEFAULT false,  -- new user joins
  new_market        BOOLEAN DEFAULT true,   -- new market created (not by you)
  any_fill          BOOLEAN DEFAULT false,  -- any trade executed (not involving you)
  your_market_order BOOLEAN DEFAULT true,   -- order placed in a market you created or traded in
  market_resolved   BOOLEAN DEFAULT true,   -- a market you created or traded in is resolved
  own_fill          BOOLEAN DEFAULT true    -- your resting order is filled by someone else
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own preferences"
  ON notification_preferences FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
