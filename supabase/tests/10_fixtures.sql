-- One group of twenty farming four hectares, and one individual farming two,
-- on a campaign whose package mixes all three bases.
INSERT INTO districts(id, code, name) VALUES (901, 'TDX', 'Testland')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO value_chains(id, name) VALUES (901, 'Test Rice'), (902, 'Test Cassava')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO warehouses(id, code, name, district_id) VALUES (901, 'WH-T', 'Test Warehouse', 901)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO distribution_sites(id, name, district_id, latitude, longitude, is_active)
  VALUES (901, 'Test Site', 901, 8.5, -12.5, 1) ON CONFLICT (id) DO NOTHING;
INSERT INTO input_items(id, item_code, name, unit, category, is_active) VALUES
  (901, 'T-TILLER', 'Test Power Tiller', 'unit',  'Equipment', 1),
  (902, 'T-HOE',    'Test Hoe',          'piece', 'Tools',     1),
  (903, 'T-NPK',    'Test NPK',          'bag',   'Fertiliser', 1),
  (904, 'T-RETIRED','Test Retired Item', 'piece', 'Tools',     0)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO stock_balance(warehouse_id, input_item_id, available) VALUES
  (901, 901, 100), (901, 902, 5000), (901, 903, 2000)
  ON CONFLICT DO NOTHING;

INSERT INTO farmers(id, farmer_code, first_name, last_name, gender, district_id,
                    value_chain_id, status, beneficiary_type, group_size, farm_size, farmer_group)
VALUES (901, 'FMR-T0901', 'Test', 'Group', 'female', 901, 901, 'approved', 'group', 20, 4.0, 'Test Group'),
       (902, 'FMR-T0902', 'Test', 'Solo',  'male',   901, 901, 'approved', 'individual', NULL, 2.0, NULL)
  ON CONFLICT (id) DO NOTHING;

INSERT INTO users(id, username, password_hash, full_name, role, is_active)
VALUES (901, 'test-approver', 'x', 'Test Approver', 'ProjectManager', true),
       (902, 'test-inactive', 'x', 'Retired Staff', 'ProjectManager', false),
       (903, 'test-field',    'x', 'Field Officer', 'FieldOfficer',   true)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles(id, plate_number, vehicle_type) VALUES (901, 'TST-901', 'Truck')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO drivers(id, full_name) VALUES (901, 'Test Driver') ON CONFLICT (id) DO NOTHING;

INSERT INTO campaigns(id, campaign_code, name, season, district_id, value_chain_id,
                      distribution_site_id, source_warehouse_id, start_date, end_date, status)
VALUES (901, 'CAM-T901', 'Test Campaign', '2026 Test', 901, 901, 901, 901,
        now(), now() + interval '30 days', 'Draft')
  ON CONFLICT (id) DO NOTHING;

-- A tiller per group, a hoe per member, two bags per hectare.
INSERT INTO campaign_items(campaign_id, input_item_id, quantity_per_farmer, basis, unit) VALUES
  (901, 901, 1, 'per_beneficiary', 'unit'),
  (901, 902, 1, 'per_member',      'piece'),
  (901, 903, 2, 'per_hectare',     'bag')
  ON CONFLICT DO NOTHING;

INSERT INTO allocations(id, campaign_id, farmer_id, status)
VALUES (901, 901, 901, 'Pending'), (902, 901, 902, 'Pending')
  ON CONFLICT (id) DO NOTHING;
