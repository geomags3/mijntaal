export function nextRank(rank: number, rating: 'know' | 'not_yet') {
  return Math.min(5, Math.max(0, rank + (rating === 'know' ? 1 : -2)));
}
export function practiceQueue(items: any[], count = 30) {
  const eligible = items.filter(
    (x) => x.practice && x.kind === 'phrase' && x.body?.en?.trim() && !x.body?._archived,
  );
  const fresh = eligible.filter((x) => !x.last_seen);
  const seen = eligible.filter((x) => x.last_seen);
  const weak = seen
    .filter((x) => x.rank <= 2)
    .sort((a, b) => a.rank - b.rank || String(a.last_seen).localeCompare(String(b.last_seen)));
  const older = [...seen].sort((a, b) => String(a.last_seen).localeCompare(String(b.last_seen)));
  const shuffled = [...fresh].sort(() => Math.random() - 0.5);
  const selected: any[] = [];
  const add = (pool: any[], n: number) => {
    for (const item of pool) {
      if (n <= 0) break;
      if (!selected.some((x) => x.id === item.id)) {
        selected.push(item);
        n--;
      }
    }
  };
  add(weak, Math.ceil(count * 0.6));
  add(shuffled, Math.ceil(count * 0.2));
  add(older, Math.max(0, count - selected.length));
  add(shuffled, count - selected.length);
  add(weak, count - selected.length);
  return selected.slice(0, count).sort(() => Math.random() - 0.5);
}
