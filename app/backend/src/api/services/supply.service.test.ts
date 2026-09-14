import assert from "node:assert/strict";
import test from "node:test";
import { cirrus } from "../../utils/appApiHelper";
import { constants } from "../../config/constants";
import * as config from "../../config/config";
import { nonCirculatingAddressesFor } from "../../config/supplyExclusions";
import { formatUnits, getSupplyMetrics, getTokenSupply } from "./supply.service";

const WAD = 10n ** 18n;
const strato = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const usdst = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const goldA = "1111111111111111111111111111111111111111";
const goldB = "2222222222222222222222222222222222222222";
const vault = "cccccccccccccccccccccccccccccccccccccccc";
const treasury = "dddddddddddddddddddddddddddddddddddddddd";
const deadAddress = "000000000000000000000000000000000000dead";
const network = "supply-test-network";

const setup = (t: any) => {
  const previous = {
    networkId: config.networkId,
    stratoToken: config.stratoToken,
    stratoNativeCustodyVault: config.stratoNativeCustodyVault,
  };
  (config as any).networkId = network;
  (config as any).stratoToken = `0x${strato.toUpperCase()}`;
  (config as any).stratoNativeCustodyVault = `0x${vault}`;
  nonCirculatingAddressesFor[network] = {
    STRATO: [{ address: `0x${treasury}`, label: "Treasury" }],
  };
  t.after(() => {
    Object.assign(config as any, previous);
    delete nonCirculatingAddressesFor[network];
  });

  t.mock.method(cirrus, "get", async (_token: string, path: string, request?: any) => {
    const params = request?.params || {};

    if (path === `/${constants.Token}`) {
      assert.equal(params.status, "eq.2");
      assert.equal(params._symbol, "in.(STRATO,USDST,GOLDST,SILVST)");
      return {
        status: 200,
        data: [
          { address: strato, _name: "STRATO", _symbol: "STRATO", _totalSupply: (1000n * WAD).toString(), customDecimals: 18 },
          { address: usdst, _name: "USDST", _symbol: "USDST", _totalSupply: (500n * WAD).toString(), customDecimals: 18 },
          { address: goldA, _name: "GOLDST", _symbol: "GOLDST", _totalSupply: "1", customDecimals: 18 },
          { address: goldB, _name: "GOLDST", _symbol: "GOLDST", _totalSupply: "1", customDecimals: 18 },
        ],
      };
    }

    if (path === `/${constants.Token}-_balances`) {
      assert.equal(params.address, `in.(${strato},${usdst})`);
      assert.ok(params.key.includes(treasury));
      assert.ok(params.key.includes(deadAddress));
      return {
        status: 200,
        data: [
          { address: strato, key: treasury, value: (300n * WAD).toString() },
          { address: strato, key: deadAddress, value: (5n * WAD).toString() },
          { address: usdst, key: deadAddress, value: "0" },
        ],
      };
    }

    if (path === `/${constants.StratoNativeCustodyVault}-lockedBalance`) {
      assert.equal(params.address, `eq.${vault}`);
      return { status: 200, data: [{ key: strato, value: (200n * WAD).toString() }] };
    }

    assert.fail(`Unexpected Cirrus path: ${path}`);
  });
};

test("circulating supply subtracts listed wallets and burn addresses, not the bridge vault", async (t) => {
  setup(t);
  const metrics = await getSupplyMetrics("access-token");

  assert.deepEqual(metrics.tokens.map((token) => token.symbol), ["STRATO", "USDST"]);

  const stratoSupply = metrics.tokens[0];
  assert.equal(stratoSupply.totalSupply, (1000n * WAD).toString());
  assert.equal(stratoSupply.circulatingSupply, (695n * WAD).toString());
  assert.equal(stratoSupply.circulatingSupplyFormatted, "695");
  assert.equal(stratoSupply.lockedInBridgeCustody, (200n * WAD).toString());
  assert.deepEqual(
    stratoSupply.nonCirculating.map((entry) => entry.label),
    ["Treasury", "Burn address"],
  );

  const usdstSupply = metrics.tokens[1];
  assert.equal(usdstSupply.circulatingSupplyFormatted, "500");
  assert.deepEqual(usdstSupply.nonCirculating, []);
  assert.equal(usdstSupply.lockedInBridgeCustody, "0");
});

test("looks tokens up by symbol or address and skips ambiguous symbols", async (t) => {
  setup(t);

  assert.equal((await getTokenSupply("access-token", "strato"))?.address, strato);
  assert.equal((await getTokenSupply("access-token", `0x${usdst.toUpperCase()}`))?.symbol, "USDST");
  assert.equal(await getTokenSupply("access-token", "GOLDST"), null);
  assert.equal(await getTokenSupply("access-token", "UNKNOWN"), null);
});

test("formats raw amounts as plain decimal numbers", () => {
  assert.equal(formatUnits(1234500000000000000000n, 18), "1234.5");
  assert.equal(formatUnits(0n, 18), "0");
  assert.equal(formatUnits(1n, 18), "0.000000000000000001");
  assert.equal(formatUnits(42n, 0), "42");
});
