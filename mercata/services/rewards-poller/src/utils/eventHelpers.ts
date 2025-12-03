import JSONbig from "json-bigint";
import { ProtocolEvent } from "../types";

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
