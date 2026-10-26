// Game-design numbers in one place. Change these, not the code that enforces them.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const RULES = Object.freeze({
  containers: Object.freeze(['stash', 'loadout']),

  loadoutSlots: 12,
  defaultStashSlots: 48,
  maxStashSlots: 240,

  // While a dedicated server reports the player as in a match, the loadout is locked for
  // player-initiated changes (game client and WebClient alike). The stash stays usable.
  // If a server crashes without ending the match, the lock lapses after this long.
  maxMatchDurationMs: 4 * HOUR,

  sessionTtlMs: Object.freeze({ game: 30 * DAY, web: 7 * DAY }),
  // Only one live game-client session per account: a new game login signs out the old one.
  singleGameSession: true,
  maxActiveWebSessions: 10,

  starterCredits: 500,
  starterKit: Object.freeze([
    { itemCode: 'rifle_service', quantity: 1 },
    { itemCode: 'ammo_556', quantity: 120 },
    { itemCode: 'medkit', quantity: 2 },
    { itemCode: 'bandage', quantity: 5 },
    { itemCode: 'vest_light', quantity: 1 },
  ]),

  // Order used by "sort" (auto-arrange). Rarer items first within a category.
  categoryOrder: Object.freeze(['weapon', 'armor', 'ammo', 'consumable', 'material', 'quest', 'cosmetic']),
  rarityOrder: Object.freeze(['legendary', 'epic', 'rare', 'uncommon', 'common']),

  maxGrantQuantity: 100_000,
  maxCreditGrant: 10_000_000,
});
