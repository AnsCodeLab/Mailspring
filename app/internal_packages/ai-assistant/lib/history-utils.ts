import { localized } from 'mailspring-exports';

export type HistoryItem = {
  sessionId: string;
  subject: string;
  preview: string;
  lastAt: number;
  count: number;
};

// "Draft a reply" x12 is useless - suffix repeated titles with their date.
export function dedupeTitles(items: HistoryItem[]): HistoryItem[] {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.subject, (counts.get(i.subject) || 0) + 1);
  return items.map((i) =>
    (counts.get(i.subject) || 0) > 1
      ? {
          ...i,
          subject: `${i.subject} · ${new Date(i.lastAt).toLocaleDateString([], {
            month: 'short',
            day: 'numeric',
          })}`,
        }
      : i
  );
}

export function groupByDate(
  items: HistoryItem[],
  now: Date
): Array<{ label: string; items: HistoryItem[] }> {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekAgo = now.getTime() - 7 * 86400000;
  const buckets: Array<{ label: string; items: HistoryItem[] }> = [
    { label: localized('Today'), items: [] },
    { label: localized('This week'), items: [] },
    { label: localized('Older'), items: [] },
  ];
  for (const i of items) {
    if (i.lastAt >= startOfToday) buckets[0].items.push(i);
    else if (i.lastAt >= weekAgo) buckets[1].items.push(i);
    else buckets[2].items.push(i);
  }
  return buckets.filter((b) => b.items.length > 0);
}
