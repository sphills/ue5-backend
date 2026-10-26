// Every error the API returns has a stable machine-readable `code` so the UE5 client and
// the WebClient can branch on it without parsing messages.
//   { "error": { "code": "STASH_FULL", "message": "...", "details": {...} } }

export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const badRequest = (code, message, details) => new AppError(400, code, message, details);
export const unauthorized = (code, message) => new AppError(401, code, message);
export const forbidden = (code, message) => new AppError(403, code, message);
export const notFound = (code, message) => new AppError(404, code, message);
export const conflict = (code, message, details) => new AppError(409, code, message, details);

// A move the game rules don't allow (stack full, slot taken, item locked...). 409 because
// the request was well-formed but conflicts with the current inventory state.
export class GameRuleError extends AppError {
  constructor(code, message, details) {
    super(409, code, message, details);
    this.name = 'GameRuleError';
  }
}

export const ruleError = (code, message, details) => new GameRuleError(code, message, details);
