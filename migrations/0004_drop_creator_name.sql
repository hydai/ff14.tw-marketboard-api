-- Drop creator_name from current_listings: 100% empty across all rows,
-- never read by any query or API handler
ALTER TABLE current_listings DROP COLUMN creator_name;
