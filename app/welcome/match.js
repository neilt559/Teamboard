// "Is one of these you?" (design §5.2 step 3): which existing name on tasks most likely belongs to this account.
// Plain module (no React), shared by the wizard and Settings > Name on tasks.
// people: [{ id, name, requested, mine }] = unlinked, unarchived kind='person' rows (lib/queries/profile.js).

export const nameTokens = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s'-]/g, ' ').split(/[\s'-]+/).filter(Boolean);

// The person a username most likely is: "khugg" -> Kyler Hugg, "jgnowak@cagecivil.com" -> John Nowak,
// "neil.terrell" -> Neil Terrell. Only a single unambiguous hit counts.
export function guessFromUsername(username, people) {
  const local = String(username || '').toLowerCase().split('@')[0].replace(/[^a-z]/g, '');
  if (local.length < 3) return null;
  const hits = (people || []).filter((p) => {
    const t = nameTokens(p.name);
    if (t.length < 2) return false;
    const first = t[0], last = t[t.length - 1];
    if (last.length < 3) return false;
    return local === first + last || (local.startsWith(first[0]) && local.endsWith(last) && local.length <= first.length + last.length + 2);
  });
  return hits.length === 1 ? hits[0] : null;
}

// Best match for a typed display name: my own pending claim first, then a case-insensitive equal name, then
// first + last token equality, then the username guess. Names someone else already asked for are never
// preselected (they can still be picked by hand).
export function bestPersonMatch({ displayName, username, people }) {
  const list = (people || []).filter((p) => !p.requested || p.mine);
  const mine = (people || []).find((p) => p.mine);
  if (mine) return mine;
  const want = String(displayName || '').trim().toLowerCase();
  if (want) {
    const eq = list.filter((p) => String(p.name).trim().toLowerCase() === want);
    if (eq.length === 1) return eq[0];
    const t = nameTokens(want);
    if (t.length >= 2) {
      const fl = list.filter((p) => {
        const pt = nameTokens(p.name);
        return pt.length >= 2 && pt[0] === t[0] && pt[pt.length - 1] === t[t.length - 1];
      });
      if (fl.length === 1) return fl[0];
    }
  }
  return guessFromUsername(username, list);
}
