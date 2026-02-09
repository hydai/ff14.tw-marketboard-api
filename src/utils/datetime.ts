/** Compute an ISO 8601 timestamp offset from now, matching the format used in the DB. */
export function isoTimeAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600000).toISOString();
}
