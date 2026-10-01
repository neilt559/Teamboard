// Suggestion box categories and statuses — shared by the API and the page.

// Kept deliberately broad. Anything filed under a retired category counts as Other.
export const CATEGORIES = [
  { key: 'culture', label: 'Culture', color: '#e2445c' },
  { key: 'operations', label: 'Operations', color: '#0086c0' },
  { key: 'ai', label: 'AI', color: '#a25ddc' },
  { key: 'cad', label: 'CAD', color: '#037f4c' },
  { key: 'clients', label: 'Marketing & Clients', color: '#c77c02' },
  { key: 'other', label: 'Other', color: '#8a8788' },
];
export const categoryKey = (k) => (CATEGORIES.some((c) => c.key === k) ? k : 'other');

export const STATUSES = [
  { key: 'new', label: 'New', color: '#8a8788' },
  { key: 'review', label: 'Under review', color: '#0086c0' },
  { key: 'planned', label: 'Planned', color: '#8f9100' },
  { key: 'done', label: 'Done', color: '#2fb344' },
  { key: 'declined', label: 'Not now', color: '#c4483e' },
];

export const categoryOf = (k) => CATEGORIES.find((c) => c.key === k) || CATEGORIES[CATEGORIES.length - 1];
export const statusOf = (k) => STATUSES.find((s) => s.key === k) || STATUSES[0];
