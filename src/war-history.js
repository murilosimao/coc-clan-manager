import { timestamp } from './cwl/errors.js';

const bare = value => String(value || '').replace(/^#/, '').toUpperCase();
const opponentOf = (war, tag) => bare(war?.clan?.tag) === tag ? bare(war?.opponent?.tag) : bare(war?.clan?.tag);
const keyOf = (war, tag) => `${war?.preparationStartTime}|${opponentOf(war, tag)}`;
const ended = (war, now) => Number.isFinite(timestamp(war?.endTime)) && timestamp(war.endTime) <= now;
const latest = items => items.map(war => war.endTime).filter(value => Number.isFinite(timestamp(value)))
  .sort((a, b) => timestamp(b) - timestamp(a))[0] || null;

// Our own capture wins when it is final. A snapshot that missed the end is kept
// only when ClashKing has nothing better, and it is marked incomplete so that
// it never counts as proof of a missed attack.
export function mergeWarHistory(tag, archiveItems = [], clashkingItems = [], now = Date.now(), limit = 10) {
  const wanted = bare(tag);
  const byKey = new Map();
  for (const war of clashkingItems) if (war?.clan && war?.opponent) byKey.set(keyOf(war, wanted), { ...war, source: 'clashking' });
  for (const item of archiveItems) {
    const war = item?.war;
    if (!war?.clan || !war?.opponent || !ended(war, now)) continue;
    const key = keyOf(war, wanted), existing = byKey.get(key);
    if (!item.final && existing?.state === 'warEnded') continue;
    byKey.set(key, { ...war, state: 'warEnded', source: 'war-archive',
      capture: { complete: item.final === true, source: item.source, observedAt: item.observedAt } });
  }
  return [...byKey.values()].sort((a, b) => timestamp(b.endTime) - timestamp(a.endTime)).slice(0, limit);
}

export function historyFreshness(archiveItems, clashkingItems, warlogItems) {
  return {
    archiveLatestEnd: latest((archiveItems || []).map(item => item?.war).filter(Boolean)),
    clashkingLatestEnd: clashkingItems ? latest(clashkingItems.filter(war => war?.state === 'warEnded')) : null,
    officialLatestEnd: warlogItems ? latest(warlogItems) : null,
  };
}
