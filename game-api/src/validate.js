// Small, dependency-free request validation. Each schema is an object of field -> rule;
// `parse(schema, input)` returns a clean object or throws a 400 VALIDATION_ERROR that lists
// every bad field, e.g. { details: { fields: { quantity: "must be an integer" } } }.
import { badRequest } from './errors.js';

const OPTIONAL = Symbol('optional');

function rule(check, { optional = false } = {}) {
  const r = (value) => check(value);
  r[OPTIONAL] = optional;
  r.optional = () => rule(check, { optional: true });
  return r;
}

export const v = {
  string: ({ min = 0, max = Infinity, pattern, message, trim = true } = {}) =>
    rule((value) => {
      if (typeof value !== 'string') return { error: 'must be a string' };
      const s = trim ? value.trim() : value;
      if (s.length < min) return { error: message ?? `must be at least ${min} characters` };
      if (s.length > max) return { error: message ?? `must be at most ${max} characters` };
      if (pattern && !pattern.test(s)) return { error: message ?? 'has an invalid format' };
      return { value: s };
    }),

  // Accepts numbers or numeric strings (HTML forms send strings).
  int: ({ min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) =>
    rule((value) => {
      const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isInteger(n)) return { error: 'must be an integer' };
      if (n < min || n > max) return { error: `must be between ${min} and ${max}` };
      return { value: n };
    }),

  oneOf: (choices) =>
    rule((value) => (choices.includes(value) ? { value } : { error: `must be one of: ${choices.join(', ')}` })),

  array: (itemSchema, { min = 0, max = 100 } = {}) =>
    rule((value) => {
      if (!Array.isArray(value)) return { error: 'must be an array' };
      if (value.length < min || value.length > max) return { error: `must have between ${min} and ${max} entries` };
      const out = [];
      for (let i = 0; i < value.length; i++) {
        const res = check(itemSchema, value[i]);
        if (res.errors) return { error: `entry ${i}: ${Object.entries(res.errors).map(([k, e]) => `${k} ${e}`).join(', ')}` };
        out.push(res.value);
      }
      return { value: out };
    }),
};

function check(schema, input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const value = {};
  const errors = {};
  for (const [key, r] of Object.entries(schema)) {
    const raw = src[key];
    if (raw === undefined || raw === null || raw === '') {
      if (!r[OPTIONAL]) errors[key] = 'is required';
      continue;
    }
    const res = r(raw);
    if ('error' in res) errors[key] = res.error;
    else value[key] = res.value;
  }
  return Object.keys(errors).length ? { errors } : { value };
}

export function parse(schema, input) {
  const res = check(schema, input);
  if (res.errors) {
    const summary = Object.entries(res.errors)
      .map(([k, e]) => `${k} ${e}`)
      .join('; ');
    throw badRequest('VALIDATION_ERROR', `Invalid request: ${summary}`, { fields: res.errors });
  }
  return res.value;
}

// Shared field rules
export const fields = {
  username: v.string({ min: 3, max: 24, pattern: /^[A-Za-z0-9_]+$/, message: 'must be 3-24 letters, digits or underscores' }),
  password: v.string({ min: 8, max: 128, trim: false }),
  email: v.string({ max: 254, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'must be a valid email address' }),
  clientType: v.oneOf(['game', 'web']),
  id: v.int({ min: 1 }),
  revision: v.int({ min: 0 }),
};
