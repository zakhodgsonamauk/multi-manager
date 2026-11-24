function parseDuration(s) {
  if (typeof s !== 'string' || s.trim() === '') return null;
  const re = /^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/;
  const m = s.trim().match(re);
  if (!m) return null;
  if (m[1] === undefined && m[2] === undefined && m[3] === undefined) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const mi = m[2] ? parseInt(m[2], 10) : 0;
  const se = m[3] ? parseInt(m[3], 10) : 0;
  return h * 3600 + mi * 60 + se;
}
