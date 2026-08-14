import assert from "node:assert/strict";
import test from "node:test";
import {
  attributionTouchFromRow,
  parseAttributionRange,
} from "../src/services/attributionService";

test("parseAttributionRange normalizes a valid half-open range", () => {
  assert.deepEqual(
    parseAttributionRange("2026-08-01", "2026-08-08"),
    {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-08T00:00:00.000Z",
      fromMs: Date.parse("2026-08-01T00:00:00.000Z"),
      toMs: Date.parse("2026-08-08T00:00:00.000Z"),
    }
  );
});

test("parseAttributionRange rejects missing, invalid, and reversed ranges", () => {
  assert.equal(parseAttributionRange(undefined, "2026-08-08"), null);
  assert.equal(parseAttributionRange("invalid", "2026-08-08"), null);
  assert.equal(parseAttributionRange("2026-08-08", "2026-08-08"), null);
  assert.equal(parseAttributionRange("2026-08-09", "2026-08-08"), null);
});

test("attributionTouchFromRow exposes campaign and expiry without empty addresses", () => {
  assert.deepEqual(
    attributionTouchFromRow(
      {
        connection_id: "17",
        external_wallet_address: "",
        strato_address: "abc123",
        connected_at: new Date("2026-08-01T12:00:00.000Z"),
        link_id: "4",
        link_label: "August metals",
        link_source: null,
      },
      90
    ),
    {
      connectionId: "17",
      connectedAt: "2026-08-01T12:00:00.000Z",
      expiresAt: "2026-10-30T12:00:00.000Z",
      externalWalletAddress: null,
      stratoAddress: "abc123",
      campaign: {
        linkId: "4",
        label: "August metals",
        source: "",
      },
    }
  );
});
