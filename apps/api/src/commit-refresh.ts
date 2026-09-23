import type { PoolClient } from 'pg';
import type { ReportRefreshProgress } from './refresh-progress.js';

/** Keep success atomic with the data, then include commit latency in history. */
export async function commitRefresh(
  client: Pick<PoolClient, 'query'>,
  syncRunId: string,
  report?: ReportRefreshProgress,
): Promise<void> {
  report?.('committing');
  await client.query('COMMIT');
  // Success already has a wall-clock timestamp inside the transaction. If the
  // connection is lost here, do not turn a committed snapshot into a failure.
  await client
    .query(
      `UPDATE sync_run SET finished_at = clock_timestamp()
     WHERE id = $1 AND status = 'succeeded'`,
      [syncRunId],
    )
    .catch(() => undefined);
}
