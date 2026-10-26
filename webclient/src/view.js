// Presentation helpers exposed to Pug templates as `h`. No game logic here: the API decides
// what is allowed; these only shape its JSON for display.

const nf = new Intl.NumberFormat('en-US');

export const CONTAINER_LABELS = { stash: 'Stash', loadout: 'Loadout' };

/** Slot grid for one container: an array of `capacity` cells, each an item or null. */
export function grid(container) {
  const cells = Array.from({ length: container.capacity }, () => null);
  for (const it of container.items) if (it.slot < cells.length) cells[it.slot] = it;
  return cells;
}

export function findItem(inventory, itemId) {
  for (const [name, container] of Object.entries(inventory.containers)) {
    const it = container.items.find((i) => i.id === itemId);
    if (it) return { ...it, container: name };
  }
  return null;
}

export function otherContainer(name) {
  return name === 'stash' ? 'loadout' : 'stash';
}

export function number(n) {
  return nf.format(Number(n) || 0);
}

export function initials(name) {
  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export function timeAgo(value, now = Date.now()) {
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.round((now - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function deviceLabel(session) {
  if (session.clientType === 'game') return 'Game client';
  const ua = session.userAgent ?? '';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : null;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  return ['Web', browser, os && `on ${os}`].filter(Boolean).join(' ');
}

const ACTION_LABELS = {
  move: 'Moved',
  stack: 'Stacked',
  swap: 'Swapped',
  split: 'Split',
  discard: 'Discarded',
  sell: 'Sold',
  sort: 'Sorted',
  grant: 'Received',
  consume: 'Used in match',
  credits: 'Credits',
};

export function eventLabel(e) {
  return ACTION_LABELS[e.action] ?? e.action;
}

export const helpers = { grid, findItem, otherContainer, number, initials, timeAgo, deviceLabel, eventLabel, CONTAINER_LABELS };
