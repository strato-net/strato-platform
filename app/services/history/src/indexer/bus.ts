import { Kafka, KafkaConfig, logLevel } from "kafkajs";
import { config } from "../config";
import { logError, logInfo } from "../utils/logger";
import { applySerialized } from "./apply";
import { fromBusEnvelope } from "./normalize";

/**
 * The live feed: slipstream publishes every chain event to the bus after the
 * batch that produced it committed. One consumer group shared by all copies
 * of this service; offsets commit after the batch is applied, so a crash
 * redelivers, and redelivery is harmless (see apply.ts).
 */
export const runBusConsumer = async (): Promise<void> => {
  const { bus } = config;
  const kafkaConfig: KafkaConfig = {
    clientId: bus.clientId,
    brokers: [`${bus.host}:${bus.port}`],
    ssl: bus.security !== "plaintext",
    logLevel: logLevel.WARN,
  };
  if (bus.security === "sasl_ssl") {
    kafkaConfig.sasl = { mechanism: "scram-sha-512", username: bus.saslUsername, password: bus.saslPassword };
  }
  const kafka = new Kafka(kafkaConfig);
  const consumer = kafka.consumer({ groupId: bus.consumerGroup });
  await consumer.connect();
  await consumer.subscribe({ topic: bus.eventsTopic, fromBeginning: true });
  logInfo("Bus", `Consuming ${bus.eventsTopic} from ${bus.host}:${bus.port} as group ${bus.consumerGroup}`);

  await consumer.run({
    eachBatchAutoResolve: false,
    eachBatch: async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary }) => {
      const events = [];
      let malformed = 0;
      let lastBlock = 0;
      for (const message of batch.messages) {
        const ev = message.value ? fromBusEnvelope(message.value.toString()) : null;
        if (!ev) {
          malformed++;
          continue;
        }
        events.push(ev);
        if (ev.blockNumber > lastBlock) lastBlock = ev.blockNumber;
      }
      const stats = await applySerialized(events, { name: "bus", blockNumber: lastBlock, cursor: Number(batch.lastOffset()) });
      for (const message of batch.messages) resolveOffset(message.offset);
      await commitOffsetsIfNecessary();
      await heartbeat();
      if (events.length > 0) logInfo("Bus", `applied ${events.length} events through block ${lastBlock}`, { ...stats, malformed });
    },
  });
};

/** Keeps the consumer alive across broker outages with a capped backoff. */
export const runBusConsumerForever = async (): Promise<void> => {
  let delay = 1000;
  for (;;) {
    try {
      await runBusConsumer();
      delay = 1000;
    } catch (error) {
      logError("Bus", error, { retryInMs: delay });
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 60000);
    }
  }
};
