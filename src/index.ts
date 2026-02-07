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
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    log.info("Scheduled event", { cron: controller.cron });

    try {
      switch (controller.cron) {
        case "*/5 * * * *":
          await dispatch(env);
          break;

        case "0 4 * * *":
          await runMaintenance(env.DB);
          break;

        case "0 6 * * *":
          await runItemSync(env);
          break;

        default:
          log.warn("Unknown cron pattern", { cron: controller.cron });
          controller.noRetry();
      }
    } catch (err) {
      log.error("Scheduled job failed", {
        cron: controller.cron,
        error: String(err),
      });
      throw err;
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
