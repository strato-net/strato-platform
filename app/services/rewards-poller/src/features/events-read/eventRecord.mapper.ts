import JSONbig from "json-bigint";
import { NonEmptyArray, ProtocolEvent, RewardsAction, EventCursor } from "../../shared/types";

const JSONbigString = JSONbig({ storeAsString: true });

export const ZERO_ADDRESS = "0000000000000000000000000000000000000000";

export const buildFilter = (values: string[]): string => {
  return values.length === 1 ? `eq.${values[0]}` : `in.(${values.join(",")})`;
};

export const parseJson = (input: any): any => {
  if (typeof input === "string") {
    return JSONbigString.parse(input);
  }
  return input;
};

export const sortEventsByBlock = (events: ProtocolEvent[]): ProtocolEvent[] => {
  return events.sort((a, b) => {
    if (a.block_number !== b.block_number) {
      return a.block_number - b.block_number;
    }
    return a.event_index - b.event_index;
  });
};

export const nextCursorAfter = (action: RewardsAction): EventCursor => ({
  blockNumber: action.blockNumber,
  eventIndex: action.eventIndex,
  block_timestamp: action.block_timestamp,
});

// Batches stay contiguous in block order so the cursor can advance after each
// one, and homogeneous because share transfers post through batchHandleTransfer.
export const splitIntoBatches = (
  actions: RewardsAction[],
  maxBatchSize: number
): NonEmptyArray<RewardsAction>[] => {
  const batches: NonEmptyArray<RewardsAction>[] = [];
  for (const action of actions) {
    const current = batches[batches.length - 1];
    if (
      current &&
      current.length < maxBatchSize &&
      Boolean(current[0].recipient) === Boolean(action.recipient)
    ) {
      current.push(action);
    } else {
      batches.push([action]);
    }
  }
  return batches;
};
