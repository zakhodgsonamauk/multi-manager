function parseDuration(s) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  const regex = /^(?:(\d+)h)?(?:\s*(\d+)m)?(?:\s*(\d+)s)?$/;
  const match = trimmed.match(regex);
  if (!match) return null;
  const h = match[1] ? parseInt(match[1], 10) : 0;
  const m = match[2] ? parseInt(match[2], 10) : 0;
  const sec = match[3] ? parseInt(match[3], 10) : 0;
  if (!match[1] && !match[2] && !match[3]) return null;
  return h * 3600 + m * 60 + sec;
}
