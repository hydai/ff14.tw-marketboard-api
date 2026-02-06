import { app } from "./api/router";
import { handleQueue } from "./queue/consumer";
import { dispatch } from "./cron/dispatcher";
import { runMaintenance } from "./cron/maintenance";
import { runItemSync } from "./cron/item-sync";
import { createLogger } from "./utils/logger";
import type { Env, QueueMessage } from "./env";

const log = createLogger("worker");

export default {
  fetch: app.fetch,

  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    log.info("Scheduled event", { cron: event.cron });

    switch (event.cron) {
      case "*/5 * * * *":
        ctx.waitUntil(dispatch(env));
        break;

      case "0 4 * * *":
        ctx.waitUntil(runMaintenance(env.DB));
        break;

      case "0 6 * * *":
        ctx.waitUntil(runItemSync(env));
        break;

      default:
        log.warn("Unknown cron pattern", { cron: event.cron });
    }
  },

  async queue(
    batch: MessageBatch<QueueMessage>,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(handleQueue(batch, env));
  },
};
