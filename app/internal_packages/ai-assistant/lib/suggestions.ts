// Global (no-thread) suggestion pills, lightly time-aware. Pure function so specs
// can pin the date.
const BASE = [
  "What's new today?",
  'Summarize this week',
  'Summarize this month',
  'Find unread emails',
];

export function getGlobalSuggestions(now: Date): string[] {
  const pills = [...BASE];
  if (now.getDay() === 1) pills[2] = 'Summarize last week'; // Monday: last week beats this month
  return pills;
}
