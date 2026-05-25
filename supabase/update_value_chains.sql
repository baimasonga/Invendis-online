-- Update value chain names to match the agreed program structure.
-- Run this once against the live database.

-- Deactivate any old value chains not in the new list
UPDATE value_chains SET is_active = false WHERE name IN (
  'Rice', 'Cassava', 'Maize', 'Groundnut', 'Vegetable', 'Cocoa', 'Coffee', 'Palm Oil'
);

-- Insert new value chains (skip if already present)
INSERT INTO value_chains (name, description, is_active) VALUES
  ('Invalley Swamp',  'Invalley swamp rice production',                                FALSE),
  ('Tree Crops',      'Oil palm and cocoa production',                                  FALSE),
  ('Vegetables',      'Bulb pepper and onions production',                              FALSE),
  ('Infrastructure',  'Roads, grain stores, and other infrastructure',                  FALSE),
  ('Agribusiness',    'Agricultural business and enterprise development',               FALSE),
  ('Adaptation',      'Farmer feed schools and other adaptation programs',              FALSE)
ON CONFLICT DO NOTHING;

-- Re-activate them
UPDATE value_chains SET is_active = true WHERE name IN (
  'Invalley Swamp', 'Tree Crops', 'Vegetables', 'Infrastructure', 'Agribusiness', 'Adaptation'
);
