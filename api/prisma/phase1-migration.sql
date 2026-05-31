-- Phase 1 Migration: Channel Masters, Brands, Campaigns, Schedule Logs
-- Run this on Railway PostgreSQL if prisma db push fails

-- ============================================================
-- 1. Channel Masters (canonical channel registry)
-- ============================================================
CREATE TABLE IF NOT EXISTS channel_masters (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  medium VARCHAR(20) NOT NULL CHECK (medium IN ('TV', 'RADIO', 'PRINT')),
  aliases TEXT[] DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. Brands (per client)
-- ============================================================
CREATE TABLE IF NOT EXISTS brands (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, name)
);

-- ============================================================
-- 3. Campaigns (per brand, linked to client)
-- ============================================================
CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(brand_id, name)
);

-- ============================================================
-- 4. Schedule Logs (monthly execution records)
-- ============================================================
CREATE TABLE IF NOT EXISTS schedule_logs (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  channel_master_id INTEGER NOT NULL REFERENCES channel_masters(id),
  brand_id INTEGER REFERENCES brands(id),
  campaign_id INTEGER REFERENCES campaigns(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  schedule_month TIMESTAMP NOT NULL,
  invoice_month TIMESTAMP,
  schedule_value DECIMAL(14,2) NOT NULL,
  invoice_value DECIMAL(14,2),
  ro_number VARCHAR(100),
  cag_pct DECIMAL(6,3),
  cag_amount DECIMAL(14,2),
  aor_pct DECIMAL(6,3),
  aor_revenue DECIMAL(14,2),
  media_group VARCHAR(255),
  notes TEXT,
  -- Phase 2 fields (reserved nullable)
  invoice_sent_to_client_date TIMESTAMP,
  payment_received_date TIMESTAMP,
  property_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 5. Alter existing tables
-- ============================================================

-- Add channel_master_id to channels (optional link)
ALTER TABLE channels ADD COLUMN IF NOT EXISTS channel_master_id INTEGER REFERENCES channel_masters(id);

-- Add bonus_pct and sponsorship_details to properties
ALTER TABLE properties ADD COLUMN IF NOT EXISTS bonus_pct DECIMAL(6,3);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS sponsorship_details TEXT;

-- ============================================================
-- 6. Indexes for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_schedule_logs_client ON schedule_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_schedule_logs_channel ON schedule_logs(channel_master_id);
CREATE INDEX IF NOT EXISTS idx_schedule_logs_month ON schedule_logs(schedule_month);
CREATE INDEX IF NOT EXISTS idx_schedule_logs_brand ON schedule_logs(brand_id);
CREATE INDEX IF NOT EXISTS idx_brands_client ON brands(client_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_brand ON campaigns(brand_id);
CREATE INDEX IF NOT EXISTS idx_channels_master ON channels(channel_master_id);
