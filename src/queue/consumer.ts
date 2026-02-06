import type { Env, QueueMessage } from "../env";
import { RateLimitedError } from "../services/universalis";
import { processFetchPrices } from "./processors/fetch-prices";
import { processFetchAggregated } from "./processors/fetch-aggregated";
import { processComputeAnalytics } from "./processors/compute-analytics";
import { createLogger } from "../utils/logger";

const log = createLogger("queue-consumer");

export async function handleQueue(
  batch: MessageBatch<QueueMessage>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await routeMessage(message.body, env);
      message.ack();
    } catch (err) {
      if (err instanceof RateLimitedError) {
        log.warn("Rate limited, retrying message", {
          type: message.body.type,
          retryAfter: err.retryAfterSeconds,
        });
        message.retry({ delaySeconds: err.retryAfterSeconds });
      } else {
        log.error("Failed to process message", {
          type: message.body.type,
          error: String(err),
        });
        message.retry();
      }
    }
  }
}

async function routeMessage(msg: QueueMessage, env: Env): Promise<void> {
  switch (msg.type) {
    case "fetch-prices":
      await processFetchPrices(msg, env);
      break;
    case "fetch-aggregated":
      await processFetchAggregated(msg, env);
      break;
    case "compute-analytics":
      await processComputeAnalytics(msg, env);
      break;
    default:
      log.error("Unknown message type", { msg });
  }
}
