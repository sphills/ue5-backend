# UE5 game backend: Game API + WebClient

Two Express apps in one npm workspace:

```
 UE5 game client ─┐  Bearer token                                   ┌──────────┐
                  ├──────────────────────►  game-api  (port 4000) ──►│  MySQL   │
 UE5 dedicated ───┘  X-Server-Key           JSON only, raw SQL       └──────────┘
   server                                         ▲
                                                  │ Bearer token, server-to-server
 Phone browser ──── HTML forms ──►  webclient (port 3000)
                                    Pug pages, no game logic, no database
```

* **game-api** is the only code that touches MySQL (via `mysql2`, hand-written SQL, no ORM). It owns accounts, sessions, inventories and every game rule, and answers JSON to all clients.
* **webclient** is a mobile-friendly site where players check and manage their stash. It renders Pug templates and does everything by calling the Game API with the player's token. It works without JavaScript.

Requires Node.js 22+ and MySQL 8.0.19+ (8.4 LTS recommended).

## Quick start

```bash
npm install                      # installs both apps (npm workspaces)
docker compose up -d mysql       # or point DB_* at your own MySQL

cp game-api/.env.example game-api/.env      # set DB_PASSWORD=change-me, add a GAME_SERVER_KEYS value
cp webclient/.env.example webclient/.env

npm run migrate                  # creates tables and seeds the item catalog
npm run dev:api                  # http://localhost:4000
npm run dev:web                  # http://localhost:3000  (open on your phone via your LAN IP)
```

Register on the WebClient (or `POST /v1/auth/register` from the game) and the account gets a starter kit and 500 credits.

## Game rules

All numbers live in `game-api/src/game/rules.js`; the engine that enforces them is `game-api/src/game/inventory.js` (pure JS, unit tested).

| Rule | Detail |
|---|---|
| Containers | `stash` (48 slots by default, per account in `accounts.stash_slots`) and `loadout` (12 slots). |
| Stacking | Each item has `max_stack`. Moving onto the same item stacks as many as fit; the rest stays put. |
| Moving | Empty slot: moves (or splits, if you send a quantity). Same item: stacks. Different item: the two stacks swap (whole stacks only). No slot: goes to the other container, onto matching stacks first, then the first free slot. |
| Loadout restrictions | Items with `loadout_allowed = 0` (materials, cosmetics) can't enter the loadout, not even by a swap. |
| Match lock | While a dedicated server reports the player in a match, the **loadout** is locked for the game client and WebClient alike. The stash stays usable. A lock lapses after 4 h if a server crashes. |
| Selling / discarding | Pays `sell_price × quantity`. Quest and cosmetic items can be flagged unsellable / undiscardable. |
| Sort | Merges partial stacks and packs a container by category, then rarity, then name. |
| Sessions | One live game-client session per account (a new game login signs out the old one); up to 10 web sessions. Game sessions last 30 days, web sessions 7. Changing the password signs out every other session. |
| Loot | End-of-match loot is delivered as far as the stash has room; the rest comes back as `undelivered` so the game can tell the player. Out-of-match grants are all-or-nothing. |

### Concurrency

Each player's inventory writes run in a transaction that first locks their `accounts` row (`SELECT … FOR UPDATE`), so the game client, the WebClient and dedicated servers can't interleave and duplicate items. Every inventory read returns a `revision`; send it back with a write and the API answers `409 INVENTORY_CONFLICT` if the inventory changed in the meantime (the WebClient does this on every form, which also stops double-submits). Every change is recorded in `inventory_events`.

## Game API reference

Base URL `http://<host>:4000`. Request and response bodies are JSON. Errors always look like:

```json
{ "error": { "code": "STASH_FULL", "message": "Not enough room in the stash for 3 × Compact SMG", "details": { } } }
```

Branch on `code`, not on `message`. Status codes: 400 bad input (`VALIDATION_ERROR` lists every bad field in `details.fields`), 401 missing/expired auth, 403 banned, 404 unknown, 409 rule broken or stale `revision`, 429 rate limited (`Retry-After` header), 503 database down.

### Public

| Method & path | Body | Notes |
|---|---|---|
| `GET /health` | | `{ status, db }` |
| `GET /v1/items` | | Full item catalog. Cache it; supports `If-None-Match`. |
| `POST /v1/auth/register` | `{ username, password, email?, client: "game"\|"web" }` | 201 `{ token, session, account }`. 5 per hour per IP. |
| `POST /v1/auth/login` | `{ username, password, client }` | `{ token, session, account }`. 10 per 15 min per IP + username. |

### Player (`Authorization: Bearer <token>`)

| Method & path | Body | Notes |
|---|---|---|
| `POST /v1/auth/logout` | | 204 |
| `GET /v1/me` | | Profile: username, credits, stash size, `inMatch` |
| `POST /v1/me/password` | `{ currentPassword, newPassword }` | Signs out other sessions |
| `GET /v1/me/sessions` | | Active sessions; `current: true` marks this one |
| `DELETE /v1/me/sessions/:id` | | 204 |
| `GET /v1/me/history?limit=50` | | Audit trail of inventory changes |
| `GET /v1/inventory` | | See shape below |
| `POST /v1/inventory/move` | `{ itemId, container?, slot?, quantity?, revision? }` | |
| `POST /v1/inventory/split` | `{ itemId, quantity, revision? }` | Into the first empty slot of the same container |
| `POST /v1/inventory/sell` | `{ itemId, quantity?, revision? }` | No quantity = whole stack |
| `POST /v1/inventory/discard` | `{ itemId, quantity?, revision? }` | |
| `POST /v1/inventory/sort` | `{ container, revision? }` | |

Inventory writes answer `{ result, inventory }`, so clients never need a second read. The inventory shape:

```json
{
  "accountId": 7, "revision": 12, "credits": 850, "inMatch": false,
  "containers": {
    "stash":   { "capacity": 48, "used": 6, "locked": false, "items": [
      { "id": 31, "slot": 0, "quantity": 70, "acquiredAt": "2026-10-25T21:30:00.000Z",
        "item": { "code": "ammo_556", "name": "5.56 Rounds", "category": "ammo", "rarity": "common",
                  "maxStack": 120, "sellPrice": 2, "sellable": true, "discardable": true,
                  "loadoutAllowed": true, "assetPath": "/Game/Items/Ammo/DA_Ammo556.DA_Ammo556" } } ] },
    "loadout": { "capacity": 12, "used": 0, "locked": false, "items": [] }
  }
}
```

### Dedicated server (`X-Server-Key: <one of GAME_SERVER_KEYS>`)

Only UE5 dedicated servers get this key. Never ship it in a client build.

| Method & path | Body | Notes |
|---|---|---|
| `POST /v1/server/sessions/verify` | `{ token }` | Check a connecting player's token; returns session + account |
| `GET /v1/server/players/:accountId` | | Profile |
| `GET /v1/server/players/:accountId/inventory` | | Inventory (e.g. to spawn the loadout) |
| `POST /v1/server/players/:accountId/match/start` | `{ matchId }` | Locks the loadout. Idempotent. |
| `POST /v1/server/players/:accountId/match/end` | `{ matchId, consume?: [{ itemId, quantity? }], grants?: [{ itemCode, quantity }], credits? }` | Removes used/lost items, delivers loot and credits, unlocks. Safe to retry: a repeat returns `alreadyProcessed: true`. |
| `POST /v1/server/players/:accountId/grants` | `{ items?: [{ itemCode, quantity }], credits?, reason, container? }` | All-or-nothing grant outside matches |

## UE5 integration notes

* Add `"HTTP"` and `"Json"` to your module's `PublicDependencyModuleNames`.
* Log in with `client: "game"`, keep the `token` in memory (or encrypted on disk), and send `Authorization: Bearer <token>` on every call. A `401` means the session ended (for example the player logged in on another PC): send them back to the login screen.
* Load `/v1/items` once at startup and map `code` → your data assets (`assetPath` is a soft object path).
* When travelling to a dedicated server, pass the token in the URL options (e.g. `?token=...`). The server reads it in its GameMode login flow, calls `/v1/server/sessions/verify` with its `X-Server-Key`, and kicks the player if that fails. The server then calls `match/start`, and `match/end` with consumed items and loot when the match finishes.

```cpp
// Minimal login call from the game client.
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

void UBackendSubsystem::Login(const FString& Username, const FString& Password)
{
    TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
    Body->SetStringField(TEXT("username"), Username);
    Body->SetStringField(TEXT("password"), Password);
    Body->SetStringField(TEXT("client"), TEXT("game"));
    FString Json;
    FJsonSerializer::Serialize(Body, TJsonWriterFactory<>::Create(&Json));

    TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Req = FHttpModule::Get().CreateRequest();
    Req->SetURL(ApiBaseUrl + TEXT("/v1/auth/login"));
    Req->SetVerb(TEXT("POST"));
    Req->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
    Req->SetContentAsString(Json);
    Req->OnProcessRequestComplete().BindLambda(
        [this](FHttpRequestPtr, FHttpResponsePtr Res, bool bOk)
        {
            TSharedPtr<FJsonObject> Obj;
            if (!bOk || !Res.IsValid() ||
                !FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Res->GetContentAsString()), Obj))
            {
                return; // network error: show "servers unreachable"
            }
            if (Res->GetResponseCode() == 200)
            {
                SessionToken = Obj->GetStringField(TEXT("token"));
            }
            else
            {
                const FString Code = Obj->GetObjectField(TEXT("error"))->GetStringField(TEXT("code"));
                // e.g. INVALID_CREDENTIALS, RATE_LIMITED, ACCOUNT_BANNED
            }
        });
    Req->ProcessRequest();
}
```

## WebClient

Pages: sign in, create account, inventory (stash / loadout tabs with a slot grid), item page (send to the other container, pick an exact slot from a tap-friendly grid, split, sell, throw away) and account (devices with remote sign-out, recent activity, password change).

* The player's Game API token sits in a signed, HttpOnly, SameSite=Lax cookie; the WebClient itself stores nothing.
* Every form carries a CSRF token and the inventory `revision`.
* It forwards the player's IP in `X-Forwarded-For`, so set the Game API's `TRUST_PROXY` to the WebClient's address. Otherwise all web logins share one rate-limit bucket.

## Tests

```bash
npm test                                   # unit tests: rules engine, validation, helpers, API client
TEST_DB_NAME=game_test npm test -w game-api   # + HTTP end-to-end test against real MySQL
```

The compose file creates the `game_test` database. Use the `.env` DB credentials (user `game`).

## Production checklist

* Run both apps behind HTTPS. Set `NODE_ENV=production`; the apps refuse to start without a real `DB_PASSWORD`, `GAME_SERVER_KEYS` (32+ chars each) and `COOKIE_SECRET`.
* Keep the Game API's database user limited to the `game` schema; only the Game API gets DB credentials.
* Login and registration rate limits are in memory. With more than one Game API process, move them to a shared store (Redis) or rate-limit at the load balancer.
* Expired sessions are purged hourly by the API process. `inventory_events` grows forever; archive it as you see fit.
* Add new items with a new migration (`003_more_items.sql`). The API refreshes its item cache every 60 s.

## Layout

```
game-api/
  migrations/           001_init.sql (schema), 002_seed_items.sql (catalog)
  scripts/migrate.js    forward-only migration runner
  src/
    app.js, server.js   Express wiring and startup
    game/               rules.js (numbers), inventory.js (rules engine), catalog.js
    repositories/       all SQL, one file per area
    services/           auth, inventory and match logic (transactions)
    routes/             public, auth, me, inventory, server
    middleware/         auth (bearer / server key), rate limit, errors
webclient/
  src/                  app.js, apiClient.js (all Game API calls), routes/, middleware/
  views/                Pug templates
  public/               styles.css, favicon.svg
```
