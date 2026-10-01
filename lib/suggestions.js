// Suggestion box categories and statuses — shared by the API and the page.

export const CATEGORIES = [
  { key: 'culture', label: 'Culture', color: '#e2445c' },
  { key: 'operations', label: 'Operations', color: '#0086c0' },
  { key: 'ai', label: 'AI', color: '#a25ddc' },
  { key: 'cad', label: 'CAD', color: '#037f4c' },
  { key: 'design', label: 'Design Standards', color: '#5559df' },
  { key: 'field', label: 'Field & Survey', color: '#9d6b34' },
  { key: 'permitting', label: 'Permitting', color: '#c77c02' },
  { key: 'software', label: 'Software & IT', color: '#0f8f9f' },
  { key: 'training', label: 'Training', color: '#2f7d32' },
  { key: 'safety', label: 'Safety', color: '#d9480f' },
  { key: 'clients', label: 'Clients & Marketing', color: '#b5179e' },
  { key: 'office', label: 'Office & Facilities', color: '#6f6c6d' },
  { key: 'other', label: 'Other', color: '#8a8788' },
];

export const STATUSES = [
  { key: 'new', label: 'New', color: '#8a8788' },
  { key: 'review', label: 'Under review', color: '#0086c0' },
  { key: 'planned', label: 'Planned', color: '#8f9100' },
  { key: 'done', label: 'Done', color: '#2fb344' },
  { key: 'declined', label: 'Not now', color: '#c4483e' },
];

export const categoryOf = (k) => CATEGORIES.find((c) => c.key === k) || CATEGORIES[CATEGORIES.length - 1];
export const statusOf = (k) => STATUSES.find((s) => s.key === k) || STATUSES[0];
