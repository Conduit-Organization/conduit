// Bookmarked sellers — persisted locally. Keyed by the seller's WALLET ADDRESS, never by `id`:
// the storefront `id` is the swarm peer key, which is random per seller restart (handoff gotcha #9),
// whereas the wallet address is stable. We store a little metadata so a bookmark can be shown
// (model, last price) even while that seller is currently offline.
const KEY = 'conduit:bookmarks:v1';

export interface Bookmark {
  address: string; // the stable key
  model: string;
  price: string;
  savedAt: number;
}

function norm(a: string): string {
  return (a || '').toLowerCase();
}

export function load(): Bookmark[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as Bookmark[]) : [];
  } catch {
    return [];
  }
}

function save(list: Bookmark[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full/blocked — ignore */ }
}

export function isBookmarked(address: string): boolean {
  return load().some((b) => norm(b.address) === norm(address));
}

export function add(b: Bookmark): Bookmark[] {
  const list = load().filter((x) => norm(x.address) !== norm(b.address));
  list.push({ ...b, address: b.address, savedAt: Date.now() });
  save(list);
  return list;
}

export function remove(address: string): Bookmark[] {
  const list = load().filter((b) => norm(b.address) !== norm(address));
  save(list);
  return list;
}

// Toggle a bookmark; returns the new list.
export function toggle(b: Bookmark): Bookmark[] {
  return isBookmarked(b.address) ? remove(b.address) : add(b);
}
