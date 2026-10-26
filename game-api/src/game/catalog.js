// In-memory view of item_definitions. Item definitions are game content that rarely changes,
// so they are cached and refreshed on a timer instead of being joined into every query.

export function toItemDef(row) {
  return Object.freeze({
    id: Number(row.id),
    code: row.code,
    name: row.name,
    description: row.description,
    category: row.category,
    rarity: row.rarity,
    maxStack: Number(row.max_stack),
    sellPrice: Number(row.sell_price),
    sellable: Boolean(Number(row.is_sellable)),
    discardable: Boolean(Number(row.is_discardable)),
    loadoutAllowed: Boolean(Number(row.loadout_allowed)),
    assetPath: row.asset_path ?? null,
  });
}

export class Catalog {
  constructor(defs = []) {
    this.defs = defs;
    this.ids = new Map(defs.map((d) => [d.id, d]));
    this.codes = new Map(defs.map((d) => [d.code, d]));
  }

  byId(id) {
    return this.ids.get(Number(id));
  }

  byCode(code) {
    return this.codes.get(code);
  }

  all() {
    return this.defs;
  }
}

/** Wraps a loader with a TTL cache so callers can just `await catalog.get()`. */
export function createCatalogCache(load, ttlMs = 60_000) {
  let current = null;
  let loadedAt = 0;
  let pending = null;

  async function refresh() {
    pending ??= load()
      .then((rows) => {
        current = new Catalog(rows.map(toItemDef));
        loadedAt = Date.now();
        return current;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }

  return {
    async get() {
      if (current && Date.now() - loadedAt < ttlMs) return current;
      if (current) {
        // serve the stale copy and refresh in the background
        refresh().catch(() => {});
        return current;
      }
      return refresh();
    },
    refresh,
  };
}
