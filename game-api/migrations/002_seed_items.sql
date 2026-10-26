-- Starter item catalog. `code` is the stable key the UE5 project uses; asset_path points at
-- each item's data asset. Re-running is safe: existing codes are updated in place.

INSERT INTO item_definitions
  (code, name, description, category, rarity, max_stack, sell_price, is_sellable, is_discardable, loadout_allowed, asset_path)
VALUES
  ('rifle_service',  'Service Rifle',      'Reliable semi-automatic rifle issued to new recruits.',         'weapon',     'common',    1,   350, 1, 1, 1, '/Game/Items/Weapons/DA_ServiceRifle.DA_ServiceRifle'),
  ('smg_compact',    'Compact SMG',        'High rate of fire, short range.',                               'weapon',     'uncommon',  1,   600, 1, 1, 1, '/Game/Items/Weapons/DA_CompactSMG.DA_CompactSMG'),
  ('rifle_marksman', 'Marksman Rifle',     'Long-range rifle with a fixed 4x optic.',                       'weapon',     'rare',      1,  1800, 1, 1, 1, '/Game/Items/Weapons/DA_MarksmanRifle.DA_MarksmanRifle'),
  ('ammo_556',       '5.56 Rounds',        'Standard rifle ammunition.',                                    'ammo',       'common',  120,     2, 1, 1, 1, '/Game/Items/Ammo/DA_Ammo556.DA_Ammo556'),
  ('ammo_9mm',       '9mm Rounds',         'Pistol and SMG ammunition.',                                    'ammo',       'common',  150,     1, 1, 1, 1, '/Game/Items/Ammo/DA_Ammo9mm.DA_Ammo9mm'),
  ('vest_light',     'Light Vest',         'Soft armor. Stops pistol rounds.',                              'armor',      'common',    1,   200, 1, 1, 1, '/Game/Items/Armor/DA_VestLight.DA_VestLight'),
  ('helmet_tactical','Tactical Helmet',    'Ballistic helmet with a mount for night vision.',               'armor',      'rare',      1,   900, 1, 1, 1, '/Game/Items/Armor/DA_HelmetTactical.DA_HelmetTactical'),
  ('medkit',         'Medkit',             'Restores a large amount of health over 5 seconds.',             'consumable', 'uncommon',  5,    80, 1, 1, 1, '/Game/Items/Consumables/DA_Medkit.DA_Medkit'),
  ('bandage',        'Bandage',            'Stops bleeding.',                                               'consumable', 'common',   10,    10, 1, 1, 1, '/Game/Items/Consumables/DA_Bandage.DA_Bandage'),
  ('scrap_metal',    'Scrap Metal',        'Crafting material.',                                            'material',   'common',   50,     3, 1, 1, 0, '/Game/Items/Materials/DA_ScrapMetal.DA_ScrapMetal'),
  ('circuit_board',  'Circuit Board',      'Crafting material salvaged from electronics.',                  'material',   'uncommon', 20,    25, 1, 1, 0, '/Game/Items/Materials/DA_CircuitBoard.DA_CircuitBoard'),
  ('fusion_core',    'Fusion Core',        'Extremely rare power source.',                                  'material',   'legendary', 3,  5000, 1, 1, 0, '/Game/Items/Materials/DA_FusionCore.DA_FusionCore'),
  ('keycard_lab',    'Lab Keycard',        'Opens the sealed lab. Quest item: cannot be sold or dropped.',  'quest',      'epic',      1,     0, 0, 0, 1, '/Game/Items/Quest/DA_KeycardLab.DA_KeycardLab'),
  ('patch_founder',  'Founder''s Patch',   'Cosmetic patch for early players.',                             'cosmetic',   'epic',      1,     0, 0, 0, 0, '/Game/Items/Cosmetics/DA_PatchFounder.DA_PatchFounder')
AS new
ON DUPLICATE KEY UPDATE
  name = new.name,
  description = new.description,
  category = new.category,
  rarity = new.rarity,
  max_stack = new.max_stack,
  sell_price = new.sell_price,
  is_sellable = new.is_sellable,
  is_discardable = new.is_discardable,
  loadout_allowed = new.loadout_allowed,
  asset_path = new.asset_path;
