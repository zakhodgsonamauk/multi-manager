function parseDuration(s) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (trimmed === '') return null;

  const pattern = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;
  const match = trimmed.match(pattern);
  if (!match) return null;

  const h = match[1] ? parseInt(match[1], 10) : 0;
  const m = match[2] ? parseInt(match[2], 10) : 0;
  const sec = match[3] ? parseInt(match[3], 10) : 0;

  if (h === 0 && m === 0 && sec === 0) return null;

  return h * 3600 + m * 60 + sec;
}
