// What the website's download is serving right now, read from
// `gh release view --json tagName,assets` on the release repo.
//
// Two answers that must never be confused (2026-10-05, the first agentbox.ac
// build): null means the output could not be read, and publishing has to stop.
// A release that simply has no download file on it is a live release serving
// nothing, `missing: true`, and publishing is exactly what fixes that.

export function liveDownload(stdout, assetName) {
  let j;
  try { j = JSON.parse(stdout); } catch { return null; }
  if (!j || typeof j.tagName !== 'string') return null;
  const asset = (Array.isArray(j.assets) ? j.assets : []).find((a) => a?.name === assetName);
  if (!asset) return { tag: j.tagName, size: 0, updatedAt: null, downloadCount: 0, missing: true };
  return { tag: j.tagName, ...asset, missing: false };
}
