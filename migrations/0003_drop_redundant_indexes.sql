-- Drop redundant indexes:
-- idx_hourly_item_time is an exact duplicate of the UNIQUE autoindex on (item_id, hour_timestamp)
-- idx_listings_item is a prefix of idx_listings_item_world on (item_id, world_id)
DROP INDEX IF EXISTS idx_hourly_item_time;
DROP INDEX IF EXISTS idx_listings_item;
