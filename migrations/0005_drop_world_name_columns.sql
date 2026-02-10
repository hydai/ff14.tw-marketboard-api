-- Normalize world_name out of data tables; world_id is already stored and
-- names are resolved at query time via WORLDS_BY_ID map in datacenters.ts
ALTER TABLE current_listings DROP COLUMN world_name;
ALTER TABLE sales_history DROP COLUMN world_name;
ALTER TABLE price_snapshots DROP COLUMN cheapest_world_name;
