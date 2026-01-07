import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import { MercataApiClient, MercataHttpMethod } from "./client.js";
import { MercataMcpConfig } from "./config.js";

function toContent(payload: unknown, label?: string): CallToolResult {
  const text = JSON.stringify(payload, null, 2);
  return {
    content: [
      {
        type: "text",
        text: label ? `${label}\n${text}` : text,
      },
    ],
  };
}

function buildEnum<T extends string>(values: readonly [T, ...T[]], description?: string) {
  const schema = z.enum(values);
  return description ? schema.describe(description) : schema;
}

export function registerMercataTools(server: McpServer, client: MercataApiClient, config: MercataMcpConfig) {
  registerApiRequestTool(server, client);
  registerTokensSnapshot(server, client);
  registerSwapSnapshot(server, client);
  registerLendingSnapshot(server, client);
  registerCdpSnapshot(server, client);
  registerBridgeData(server, client);
  registerRewardsData(server, client);
  registerAdminData(server, client);
  registerEventsSearch(server, client);
  registerProtocolRevenue(server, client);
  registerRpcProxy(server, client);
  registerSwapActions(server, client);
  registerTokenActions(server, client);
  registerLendingActions(server, client);
  registerCdpActions(server, client);
  registerBridgeActions(server, client);
  registerRewardsActions(server, client);
  registerAdminActions(server, client);
  registerOracleActions(server, client);
}

function registerApiRequestTool(server: McpServer, client: MercataApiClient) {
  const apiRequestSchema = z.object({
    method: buildEnum<MercataHttpMethod>(["get", "post", "put", "patch", "delete"] as const),
    path: z.string().describe("Path relative to the API base, e.g. /tokens or tokens/v2/earning-assets"),
    query: z.record(z.string(), z.any()).optional().describe("Optional query parameters"),
    body: z.any().optional().describe("Optional JSON payload"),
    headers: z.record(z.string(), z.string()).optional().describe("Additional headers to send"),
    accessToken: z.string().optional().describe("Override access token (defaults to MERCATA_ACCESS_TOKEN)"),
  });
  type ApiRequestArgs = z.infer<typeof apiRequestSchema>;

  server.registerTool(
    "mercata.api-request",
    {
      title: "Raw Mercata API call",
      description: "Call any Mercata backend endpoint with an arbitrary method, path, query, and body.",
      inputSchema: apiRequestSchema,
    },
    async (input: ApiRequestArgs) => {
      const data = await client.request(input.method, input.path, {
        params: input.query,
        data: input.body,
        headers: input.headers,
        tokenOverride: input.accessToken,
      });
      return toContent(data, `Response from ${input.method.toUpperCase()} ${input.path}`);
    },
  );
}

function registerTokensSnapshot(server: McpServer, client: MercataApiClient) {
  const tokensSchema = z.object({
    status: z.string().optional().describe("Optional status filter, e.g. eq.2"),
    includeStats: z.boolean().default(false),
    includeEarningAssets: z.boolean().default(true),
    includeBalances: z.boolean().default(true),
    tokenAddress: z.string().optional().describe("When set, fetch this specific token and balance history"),
    poolAddress: z.string().optional().describe("When set, fetch pool price history for this swap pool"),
  });
  type TokensArgs = z.infer<typeof tokensSchema>;

  server.registerTool(
    "mercata.tokens",
    {
      title: "Tokens and balances",
      description: "Fetch token catalog, user balances, voucher balance, and earning assets.",
      inputSchema: tokensSchema,
    },
    async ({ status, includeStats, includeEarningAssets, includeBalances, tokenAddress, poolAddress }: TokensArgs) => {
      const tasks: Promise<unknown>[] = [];
      const result: Record<string, unknown> = {};

      tasks.push(
        client
          .request("get", "/tokens", { params: status ? { status } : undefined })
          .then((data) => (result.tokens = data)),
      );

      if (includeBalances) {
        tasks.push(
          client.request("get", "/tokens/balance").then((data) => (result.balances = data)),
        );
        tasks.push(
          client.request("get", "/vouchers/balance").then((data) => (result.voucherBalance = data)),
        );
      }

      if (includeStats) {
        tasks.push(
          client.request("get", "/tokens/stats").then((data) => (result.stats = data)),
        );
      }

      if (includeEarningAssets) {
        tasks.push(
          client.request("get", "/tokens/v2/earning-assets").then((data) => (result.earningAssets = data)),
        );
      }

      if (tokenAddress) {
        tasks.push(
          client
            .request("get", `/tokens/v2/balance-history/${tokenAddress}`)
            .then((data) => (result.balanceHistory = data)),
        );
      }

      if (poolAddress) {
        tasks.push(
          client
            .request("get", `/tokens/v2/pool-price-history/${poolAddress}`)
            .then((data) => (result.poolPriceHistory = data)),
        );
      }

      await Promise.all(tasks);
      return toContent(result, "Token snapshot");
    },
  );
}

function registerSwapSnapshot(server: McpServer, client: MercataApiClient) {
  const swapSchema = z.object({
    tokenA: z.string().optional().describe("Token address A to find pairable pools"),
    tokenB: z.string().optional().describe("Token address B to find pairable pools"),
    poolAddress: z.string().optional().describe("Pool address to fetch details"),
    includePositions: z.boolean().default(false),
    includeHistory: z.boolean().default(false),
    historyLimit: z.number().int().optional(),
    historyPage: z.number().int().optional(),
  });
  type SwapArgs = z.infer<typeof swapSchema>;

  server.registerTool(
    "mercata.swap",
    {
      title: "Swap pools and liquidity",
      description: "Inspect swap pools, supported tokens, LP positions, history, and specific pool details.",
      inputSchema: swapSchema,
    },
    async ({ tokenA, tokenB, poolAddress, includePositions, includeHistory, historyLimit, historyPage }: SwapArgs) => {
      const result: Record<string, unknown> = {};
      const tasks: Promise<unknown>[] = [];

      tasks.push(
        client.request("get", "/swap-pools").then((data) => (result.pools = data)),
      );
      tasks.push(
        client.request("get", "/swap-pools/tokens").then((data) => (result.swappableTokens = data)),
      );

      if (tokenA) {
        tasks.push(
          client.request("get", `/swap-pools/tokens/${tokenA}`).then((data) => (result.pairableTokens = data)),
        );
      }

      if (tokenA && tokenB) {
        tasks.push(
          client
            .request("get", `/swap-pools/${tokenA}/${tokenB}`)
            .then((data) => (result.poolsForPair = data)),
        );
      }

      if (poolAddress) {
        tasks.push(
          client.request("get", `/swap-pools/${poolAddress}`).then((data) => (result.pool = data)),
        );
        if (includeHistory) {
          tasks.push(
            client
              .request("get", `/swap-history/${poolAddress}`, {
                params: {
                  limit: historyLimit,
                  page: historyPage,
                },
              })
              .then((data) => (result.history = data)),
          );
        }
      }

      if (includePositions) {
        tasks.push(
          client.request("get", "/swap-pools/positions").then((data) => (result.lpPositions = data)),
        );
      }

      await Promise.all(tasks);
      return toContent(result, "Swap data");
    },
  );
}

function registerSwapActions(server: McpServer, client: MercataApiClient) {
  const createPoolSchema = z.object({
    tokenA: z.string().describe("Address of token A"),
    tokenB: z.string().describe("Address of token B"),
    isStable: z.boolean().default(false).describe("Whether the pool is stable"),
  });
  server.registerTool(
    "mercata.swap.create-pool",
    {
      title: "Create swap pool",
      description: "Create a new swap pool between tokenA and tokenB.",
      inputSchema: createPoolSchema,
    },
    async (input: z.infer<typeof createPoolSchema>) => {
      const data = await client.request("post", "/swap-pools", { data: input });
      return toContent(data, "Created swap pool");
    },
  );

  const addDualSchema = z.object({
    poolAddress: z.string().describe("Pool address"),
    tokenBAmount: z.string().describe("Amount of token B to deposit"),
    maxTokenAAmount: z.string().describe("Max token A amount to pair"),
    stakeLPToken: z.boolean().optional().describe("Whether to stake LP tokens automatically"),
  });
  server.registerTool(
    "mercata.swap.add-liquidity",
    {
      title: "Add dual-sided liquidity",
      description: "Provide both tokens to a pool.",
      inputSchema: addDualSchema,
    },
    async (input: z.infer<typeof addDualSchema>) => {
      const { poolAddress, ...body } = input;
      const data = await client.request("post", `/swap-pools/${poolAddress}/liquidity`, { data: body });
      return toContent(data, "Added liquidity");
    },
  );

  const addSingleSchema = z.object({
    poolAddress: z.string().describe("Pool address"),
    singleTokenAmount: z.string().describe("Amount of the input token"),
    isAToB: z.boolean().describe("Direction of deposit (true = token A to B)"),
    stakeLPToken: z.boolean().optional().describe("Whether to stake LP tokens automatically"),
  });
  server.registerTool(
    "mercata.swap.add-liquidity-single",
    {
      title: "Add single-sided liquidity",
      description: "Provide liquidity using only one token.",
      inputSchema: addSingleSchema,
    },
    async (input: z.infer<typeof addSingleSchema>) => {
      const { poolAddress, ...body } = input;
      const data = await client.request("post", `/swap-pools/${poolAddress}/liquidity/single`, { data: body });
      return toContent(data, "Added single-sided liquidity");
    },
  );

  const removeSchema = z.object({
    poolAddress: z.string().describe("Pool address"),
    lpTokenAmount: z.string().describe("LP token amount to redeem"),
    includeStakedLPToken: z.boolean().optional().describe("Include staked LP tokens"),
  });
  server.registerTool(
    "mercata.swap.remove-liquidity",
    {
      title: "Remove liquidity",
      description: "Redeem LP tokens from a pool.",
      inputSchema: removeSchema,
    },
    async (input: z.infer<typeof removeSchema>) => {
      const { poolAddress, ...body } = input;
      const data = await client.request("delete", `/swap-pools/${poolAddress}/liquidity`, { data: body });
      return toContent(data, "Removed liquidity");
    },
  );

  const swapSchema = z.object({
    poolAddress: z.string().describe("Pool address"),
    isAToB: z.boolean().describe("Swap direction (true = token A to B)"),
    amountIn: z.string().describe("Input token amount"),
    minAmountOut: z.string().describe("Minimum acceptable output"),
  });
  server.registerTool(
    "mercata.swap.execute",
    {
      title: "Execute swap",
      description: "Swap within an existing pool.",
      inputSchema: swapSchema,
    },
    async (input: z.infer<typeof swapSchema>) => {
      const data = await client.request("post", "/swap", { data: input });
      return toContent(data, "Swap transaction");
    },
  );
}

function registerLendingSnapshot(server: McpServer, client: MercataApiClient) {
  const lendingSchema = z.object({
    includeInterest: z.boolean().default(false),
    includeNearUnhealthy: z.boolean().default(false),
  });
  type LendingArgs = z.infer<typeof lendingSchema>;

  server.registerTool(
    "mercata.lending",
    {
      title: "Lending dashboard",
      description: "Fetch lending pools, loans, liquidity, collateral, liquidations, and safety module state.",
      inputSchema: lendingSchema,
    },
    async ({ includeInterest, includeNearUnhealthy }: LendingArgs) => {
      const result: Record<string, unknown> = {};
      const tasks: Promise<unknown>[] = [];

      tasks.push(client.request("get", "/lending/pools").then((data) => (result.pools = data)));
      tasks.push(client.request("get", "/lending/liquidity").then((data) => (result.liquidity = data)));
      tasks.push(client.request("get", "/lending/collateral").then((data) => (result.collateral = data)));
      tasks.push(client.request("get", "/lending/loans").then((data) => (result.loans = data)));
      tasks.push(client.request("get", "/lending/liquidate").then((data) => (result.liquidatable = data)));
      tasks.push(client.request("get", "/lending/safety/info").then((data) => (result.safety = data)));

      if (includeNearUnhealthy) {
        tasks.push(
          client
            .request("get", "/lending/liquidate/near-unhealthy", { params: { margin: 0.2 } })
            .then((data) => (result.nearUnhealthy = data)),
        );
      }

      if (includeInterest) {
        tasks.push(
          client.request("get", "/lending/interest").then((data) => (result.interest = data)),
        );
      }

      await Promise.all(tasks);
      return toContent(result, "Lending data");
    },
  );
}

function registerCdpSnapshot(server: McpServer, client: MercataApiClient) {
  const cdpSchema = z.object({
    asset: z.string().optional().describe("Specific asset address to inspect config and vault"),
    includeStats: z.boolean().default(true),
    includeInterest: z.boolean().default(false),
  });
  type CdpArgs = z.infer<typeof cdpSchema>;

  server.registerTool(
    "mercata.cdp",
    {
      title: "CDP overview",
      description: "Fetch CDP vaults, assets, debt metrics, bad debt, and interest/stats.",
      inputSchema: cdpSchema,
    },
    async ({ asset, includeStats, includeInterest }: CdpArgs) => {
      const result: Record<string, unknown> = {};
      const tasks: Promise<unknown>[] = [];

      tasks.push(client.request("get", "/cdp/vaults").then((data) => (result.vaults = data)));
      tasks.push(client.request("get", "/cdp/assets").then((data) => (result.assets = data)));
      tasks.push(client.request("get", "/cdp/bad-debt").then((data) => (result.badDebt = data)));

      if (asset) {
        tasks.push(
          client.request("get", `/cdp/vaults/${asset}`).then((data) => (result.vault = data)),
        );
        tasks.push(
          client.request("get", `/cdp/config/${asset}`).then((data) => (result.assetConfig = data)),
        );
        tasks.push(
          client.request("post", "/cdp/asset-debt-info", { data: { asset } }).then((data) => (result.assetDebt = data)),
        );
      }

      if (includeStats) {
        tasks.push(client.request("get", "/cdp/stats").then((data) => (result.stats = data)));
      }

      if (includeInterest) {
        tasks.push(client.request("get", "/cdp/interest").then((data) => (result.interest = data)));
      }

      await Promise.all(tasks);
      return toContent(result, "CDP data");
    },
  );
}

function registerBridgeData(server: McpServer, client: MercataApiClient) {
  const bridgeSchema = z.object({
    chainId: z.string().optional().describe("External chain ID to list bridgeable tokens"),
    txType: buildEnum(["deposit", "withdrawal"] as const).optional().describe("Transaction type to fetch"),
    limit: z.number().int().optional(),
    offset: z.number().int().optional(),
    context: z.string().optional().describe("Pass 'admin' to include admin context transactions"),
    includeSummary: z.boolean().default(true),
  });
  type BridgeArgs = z.infer<typeof bridgeSchema>;

  server.registerTool(
    "mercata.bridge",
    {
      title: "Bridge networks and activity",
      description: "Fetch bridge network configs, bridgeable tokens, deposit/withdrawal history, and withdrawal summary.",
      inputSchema: bridgeSchema,
    },
    async ({ chainId, txType, limit, offset, context, includeSummary }: BridgeArgs) => {
      const result: Record<string, unknown> = {};
      const tasks: Promise<unknown>[] = [];

      tasks.push(client.request("get", "/bridge/networkConfigs").then((data) => (result.networks = data)));

      if (chainId) {
        tasks.push(
          client
            .request("get", `/bridge/bridgeableTokens/${chainId}`)
            .then((data) => (result.bridgeableTokens = data)),
        );
      }

      if (txType) {
        tasks.push(
          client
            .request("get", `/bridge/transactions/${txType}`, {
              params: {
                limit,
                offset,
                context,
              },
            })
            .then((data) => (result.transactions = data)),
        );
      }

      if (includeSummary) {
        tasks.push(
          client.request("get", "/bridge/withdrawalSummary").then((data) => (result.withdrawalSummary = data)),
        );
      }

      await Promise.all(tasks);
      return toContent(result, "Bridge data");
    },
  );
}

function registerRewardsData(server: McpServer, client: MercataApiClient) {
  const rewardsSchema = z.object({
    userAddress: z.string().optional().describe("User address to fetch activity data for"),
    includeLeaderboard: z.boolean().default(false),
    leaderboardLimit: z.number().int().optional(),
    leaderboardOffset: z.number().int().optional(),
  });
  type RewardsArgs = z.infer<typeof rewardsSchema>;

  server.registerTool(
    "mercata.rewards",
    {
      title: "Rewards overview",
      description: "Fetch rewards overview, activities, user rewards, pending balances, and leaderboard.",
      inputSchema: rewardsSchema,
    },
    async ({ userAddress, includeLeaderboard, leaderboardLimit, leaderboardOffset }: RewardsArgs) => {
      const result: Record<string, unknown> = {};
      const tasks: Promise<unknown>[] = [];

      tasks.push(client.request("get", "/rewards/pending").then((data) => (result.pending = data)));
      tasks.push(client.request("get", "/rewards/overview").then((data) => (result.overview = data)));
      tasks.push(client.request("get", "/rewards/activities").then((data) => (result.activities = data)));
      tasks.push(client.request("get", "/rewards/pools").then((data) => (result.pools = data)));

      if (userAddress) {
        tasks.push(
          client
            .request("get", `/rewards/activities/${userAddress}`)
            .then((data) => (result.userActivities = data)),
        );
      }

      if (includeLeaderboard) {
        tasks.push(
          client
            .request("get", "/rewards/leaderboard", { params: { limit: leaderboardLimit, offset: leaderboardOffset } })
            .then((data) => (result.leaderboard = data)),
        );
      }

      await Promise.all(tasks);
      return toContent(result, "Rewards data");
    },
  );
}

function registerAdminData(server: McpServer, client: MercataApiClient) {
  const adminSchema = z.object({
    search: z.string().optional().describe("Contract search query"),
    contractAddress: z.string().optional().describe("Contract address to fetch details"),
    includeConfig: z.boolean().default(true),
  });
  type AdminArgs = z.infer<typeof adminSchema>;

  server.registerTool(
    "mercata.admin",
    {
      title: "Admin and governance",
      description: "Fetch current user profile, admins, open issues, contract search, and config.",
      inputSchema: adminSchema,
    },
    async ({ search, contractAddress, includeConfig }: AdminArgs) => {
      const result: Record<string, unknown> = {};
      const tasks: Promise<unknown>[] = [];

      tasks.push(client.request("get", "/user/me").then((data) => (result.me = data)));
      tasks.push(client.request("get", "/user/admin").then((data) => (result.admins = data)));
      tasks.push(client.request("get", "/user/admin/issues").then((data) => (result.openIssues = data)));

      if (search) {
        tasks.push(
          client
            .request("get", "/user/admin/contract/search", { params: { search } })
            .then((data) => (result.searchResults = data)),
        );
      }

      if (contractAddress) {
        tasks.push(
          client
            .request("get", "/user/admin/contract/details", { params: { address: contractAddress } })
            .then((data) => (result.contractDetails = data)),
        );
      }

      if (includeConfig) {
        tasks.push(client.request("get", "/config").then((data) => (result.config = data)));
      }

      await Promise.all(tasks);
      return toContent(result, "Admin data");
    },
  );
}

function registerEventsSearch(server: McpServer, client: MercataApiClient) {
  const eventsSchema = z.object({
    order: z.string().optional().describe("Order clause, e.g. block_timestamp.desc"),
    limit: z.string().optional(),
    offset: z.string().optional(),
  });
  type EventsArgs = z.infer<typeof eventsSchema>;

  server.registerTool(
    "mercata.events",
    {
      title: "Event search",
      description: "Query chain events through the backend search interface.",
      inputSchema: eventsSchema,
    },
    async ({ order, limit, offset }: EventsArgs) => {
      const result = await client.request("get", "/events", { params: { order, limit, offset } });
      return toContent(result, "Events");
    },
  );
}

function registerProtocolRevenue(server: McpServer, client: MercataApiClient) {
  const revenueSchema = z.object({
    protocol: z.string().optional().describe("Optional protocol: cdp|lending|swap|gas"),
    period: z.string().optional().describe("Optional period: daily|weekly|monthly|ytd|allTime"),
  });
  type RevenueArgs = z.infer<typeof revenueSchema>;

  server.registerTool(
    "mercata.protocol-fees",
    {
      title: "Protocol revenue",
      description: "Fetch aggregated or per-protocol revenue summaries.",
      inputSchema: revenueSchema,
    },
    async ({ protocol, period }: RevenueArgs) => {
      if (protocol && period) {
        const data = await client.request("get", `/protocol-fees/revenue/period/${period}`, {
          params: { protocol },
        });
        return toContent(data, `Revenue for ${protocol} (${period})`);
      }

      if (protocol) {
        const data = await client.request("get", `/protocol-fees/revenue/${protocol}`);
        return toContent(data, `Revenue for ${protocol}`);
      }

      const data = await client.request("get", "/protocol-fees/revenue");
      return toContent(data, "Aggregated revenue");
    },
  );
}

function registerRpcProxy(server: McpServer, client: MercataApiClient) {
  const rpcSchema = z.object({
    chainId: z.string().describe("Numeric chain ID, e.g. 1 or 11155111"),
    payload: z.record(z.string(), z.any()).describe("Raw JSON-RPC payload"),
  });
  type RpcArgs = z.infer<typeof rpcSchema>;

  server.registerTool(
    "mercata.rpc",
    {
      title: "RPC proxy",
      description: "Proxy a JSON-RPC request through the backend RPC router.",
      inputSchema: rpcSchema,
    },
    async ({ chainId, payload }: RpcArgs) => {
      if (!payload || typeof payload !== "object") {
        throw new McpError(ErrorCode.InvalidParams, "payload must be a JSON-RPC object");
      }
      const data = await client.request("post", `/rpc/${chainId}`, { data: payload });
      return toContent(data, `RPC response for chain ${chainId}`);
    },
  );
}

function registerTokenActions(server: McpServer, client: MercataApiClient) {
  const createSchema = z.object({
    name: z.string(),
    symbol: z.string(),
    initialSupply: z.string(),
    description: z.string(),
    customDecimals: z.number().int(),
    images: z.array(z.string()).optional(),
    files: z.array(z.string()).optional(),
    fileNames: z.array(z.string()).optional(),
  });
  server.registerTool(
    "mercata.tokens.create",
    {
      title: "Create token",
      description: "Admin: create a new token.",
      inputSchema: createSchema,
    },
    async (input: z.infer<typeof createSchema>) => {
      const payload = {
        ...input,
        images: input.images ? JSON.stringify(input.images) : undefined,
        files: input.files ? JSON.stringify(input.files) : undefined,
        fileNames: input.fileNames ? JSON.stringify(input.fileNames) : undefined,
      };
      const data = await client.request("post", "/tokens", { data: payload });
      return toContent(data, "Token creation transaction");
    },
  );

  const transferSchema = z.object({
    address: z.string(),
    to: z.string(),
    value: z.string(),
  });
  server.registerTool(
    "mercata.tokens.transfer",
    {
      title: "Transfer token",
      description: "Transfer tokens to another address.",
      inputSchema: transferSchema,
    },
    async (input: z.infer<typeof transferSchema>) => {
      const data = await client.request("post", "/tokens/transfer", { data: input });
      return toContent(data, "Transfer transaction");
    },
  );

  const approveSchema = z.object({
    address: z.string(),
    spender: z.string(),
    value: z.string(),
  });
  server.registerTool(
    "mercata.tokens.approve",
    {
      title: "Approve spender",
      description: "Approve allowance for a spender.",
      inputSchema: approveSchema,
    },
    async (input: z.infer<typeof approveSchema>) => {
      const data = await client.request("post", "/tokens/approve", { data: input });
      return toContent(data, "Approve transaction");
    },
  );

  const transferFromSchema = z.object({
    address: z.string(),
    from: z.string(),
    to: z.string(),
    value: z.string(),
  });
  server.registerTool(
    "mercata.tokens.transfer-from",
    {
      title: "Transfer from",
      description: "Transfer tokens on behalf of another address.",
      inputSchema: transferFromSchema,
    },
    async (input: z.infer<typeof transferFromSchema>) => {
      const data = await client.request("post", "/tokens/transferFrom", { data: input });
      return toContent(data, "TransferFrom transaction");
    },
  );

  const setStatusSchema = z.object({
    address: z.string(),
    status: z.number().int().describe("1=PENDING, 2=ACTIVE, 3=LEGACY"),
  });
  server.registerTool(
    "mercata.tokens.set-status",
    {
      title: "Set token status",
      description: "Admin: update token status.",
      inputSchema: setStatusSchema,
    },
    async (input: z.infer<typeof setStatusSchema>) => {
      const data = await client.request("post", "/tokens/setStatus", { data: input });
      return toContent(data, "Status update");
    },
  );
}

function registerLendingActions(server: McpServer, client: MercataApiClient) {
  const collateralSchema = z.object({
    asset: z.string(),
    amount: z.string(),
  });
  server.registerTool(
    "mercata.lending.supply-collateral",
    {
      title: "Supply collateral",
      description: "Supply collateral to lending pool.",
      inputSchema: collateralSchema,
    },
    async (input: z.infer<typeof collateralSchema>) => {
      const data = await client.request("post", "/lending/collateral", { data: input });
      return toContent(data, "Supply collateral");
    },
  );

  server.registerTool(
    "mercata.lending.withdraw-collateral",
    {
      title: "Withdraw collateral",
      description: "Withdraw supplied collateral.",
      inputSchema: collateralSchema,
    },
    async (input: z.infer<typeof collateralSchema>) => {
      const data = await client.request("delete", "/lending/collateral", { data: input });
      return toContent(data, "Withdraw collateral");
    },
  );

  const withdrawMaxSchema = z.object({ asset: z.string() });
  server.registerTool(
    "mercata.lending.withdraw-collateral-max",
    {
      title: "Withdraw max collateral",
      description: "Withdraw maximum available collateral for an asset.",
      inputSchema: withdrawMaxSchema,
    },
    async (input: z.infer<typeof withdrawMaxSchema>) => {
      const data = await client.request("post", "/lending/collateral/withdraw-max", { data: input });
      return toContent(data, "Withdraw max collateral");
    },
  );

  const borrowSchema = z.object({ amount: z.string() });
  server.registerTool(
    "mercata.lending.borrow",
    {
      title: "Borrow USDST",
      description: "Borrow from lending pool.",
      inputSchema: borrowSchema,
    },
    async (input: z.infer<typeof borrowSchema>) => {
      const data = await client.request("post", "/lending/loans", { data: input });
      return toContent(data, "Borrow transaction");
    },
  );

  server.registerTool(
    "mercata.lending.borrow-max",
    {
      title: "Borrow max",
      description: "Borrow the maximum available USDST.",
      inputSchema: z.object({}),
    },
    async () => {
      const data = await client.request("post", "/lending/loans/borrow-max");
      return toContent(data, "Borrow max transaction");
    },
  );

  const repaySchema = z.object({ amount: z.string() });
  server.registerTool(
    "mercata.lending.repay",
    {
      title: "Repay loan",
      description: "Repay outstanding debt.",
      inputSchema: repaySchema,
    },
    async (input: z.infer<typeof repaySchema>) => {
      const data = await client.request("patch", "/lending/loans", { data: input });
      return toContent(data, "Repay transaction");
    },
  );

  server.registerTool(
    "mercata.lending.repay-all",
    {
      title: "Repay all loans",
      description: "Repay all debt.",
      inputSchema: z.object({}),
    },
    async () => {
      const data = await client.request("post", "/lending/loans/repay-all");
      return toContent(data, "Repay all transaction");
    },
  );

  const poolDepositSchema = z.object({
    amount: z.string(),
    stakeMToken: z.boolean(),
  });
  server.registerTool(
    "mercata.lending.deposit-liquidity",
    {
      title: "Deposit pool liquidity",
      description: "Deposit into lending pool.",
      inputSchema: poolDepositSchema,
    },
    async (input: z.infer<typeof poolDepositSchema>) => {
      const data = await client.request("post", "/lending/pools/liquidity", { data: input });
      return toContent(data, "Pool deposit");
    },
  );

  const poolWithdrawSchema = z.object({
    amount: z.string(),
    includeStakedMToken: z.boolean().optional(),
  });
  server.registerTool(
    "mercata.lending.withdraw-liquidity",
    {
      title: "Withdraw pool liquidity",
      description: "Withdraw from lending pool.",
      inputSchema: poolWithdrawSchema,
    },
    async (input: z.infer<typeof poolWithdrawSchema>) => {
      const data = await client.request("delete", "/lending/pools/liquidity", { data: input });
      return toContent(data, "Pool withdrawal");
    },
  );

  server.registerTool(
    "mercata.lending.withdraw-liquidity-all",
    {
      title: "Withdraw all pool liquidity",
      description: "Withdraw all available liquidity.",
      inputSchema: z.object({}),
    },
    async () => {
      const data = await client.request("post", "/lending/pools/withdraw-all");
      return toContent(data, "Pool withdraw all");
    },
  );

  const safetyStakeSchema = z.object({
    amount: z.string(),
    stakeSToken: z.boolean(),
  });
  server.registerTool(
    "mercata.lending.safety-stake",
    {
      title: "Safety stake",
      description: "Stake USDST into safety module.",
      inputSchema: safetyStakeSchema,
    },
    async (input: z.infer<typeof safetyStakeSchema>) => {
      const data = await client.request("post", "/lending/safety/stake", { data: input });
      return toContent(data, "Safety stake");
    },
  );

  server.registerTool(
    "mercata.lending.safety-cooldown",
    {
      title: "Start safety cooldown",
      description: "Begin safety module cooldown.",
      inputSchema: z.object({}),
    },
    async () => {
      const data = await client.request("post", "/lending/safety/cooldown");
      return toContent(data, "Safety cooldown");
    },
  );

  const safetyRedeemSchema = z.object({
    sharesAmount: z.string(),
    includeStakedSToken: z.boolean(),
  });
  server.registerTool(
    "mercata.lending.safety-redeem",
    {
      title: "Redeem safety",
      description: "Redeem sUSDST shares.",
      inputSchema: safetyRedeemSchema,
    },
    async (input: z.infer<typeof safetyRedeemSchema>) => {
      const data = await client.request("post", "/lending/safety/redeem", { data: input });
      return toContent(data, "Safety redeem");
    },
  );

  server.registerTool(
    "mercata.lending.safety-redeem-all",
    {
      title: "Redeem all safety",
      description: "Redeem all sUSDST shares.",
      inputSchema: z.object({}),
    },
    async () => {
      const data = await client.request("post", "/lending/safety/redeem-all");
      return toContent(data, "Safety redeem all");
    },
  );

  const liquidationSchema = z.object({
    id: z.string().describe("Loan ID"),
    collateralAsset: z.string().optional(),
    repayAmount: z.string().optional(),
    minCollateralOut: z.string().optional(),
  });
  server.registerTool(
    "mercata.lending.liquidate",
    {
      title: "Execute liquidation",
      description: "Liquidate a lending loan.",
      inputSchema: liquidationSchema,
    },
    async (input: z.infer<typeof liquidationSchema>) => {
      const { id, ...body } = input;
      const data = await client.request("post", `/lending/liquidate/${id}`, { data: body });
      return toContent(data, "Liquidation");
    },
  );

  const lendAdminConfigSchema = z.object({
    asset: z.string(),
    ltv: z.number().int(),
    liquidationThreshold: z.number().int(),
    liquidationBonus: z.number().int(),
    interestRate: z.number().int(),
    reserveFactor: z.number().int(),
    perSecondFactorRAY: z.string(),
  });
  server.registerTool(
    "mercata.lending.configure-asset",
    {
      title: "Configure lending asset",
      description: "Admin: set lending parameters.",
      inputSchema: lendAdminConfigSchema,
    },
    async (input: z.infer<typeof lendAdminConfigSchema>) => {
      const data = await client.request("post", "/lending/admin/configure-asset", { data: input });
      return toContent(data, "Configure asset");
    },
  );

  const sweepSchema = z.object({ amount: z.string() });
  server.registerTool(
    "mercata.lending.sweep-reserves",
    {
      title: "Sweep reserves",
      description: "Admin: sweep protocol reserves.",
      inputSchema: sweepSchema,
    },
    async (input: z.infer<typeof sweepSchema>) => {
      const data = await client.request("post", "/lending/admin/sweep-reserves", { data: input });
      return toContent(data, "Sweep reserves");
    },
  );

  const debtCeilingsSchema = z.object({
    assetUnits: z.string(),
    usdValue: z.string(),
  });
  server.registerTool(
    "mercata.lending.set-debt-ceilings",
    {
      title: "Set debt ceilings",
      description: "Admin: set global/per-asset debt ceilings.",
      inputSchema: debtCeilingsSchema,
    },
    async (input: z.infer<typeof debtCeilingsSchema>) => {
      const data = await client.request("post", "/lending/admin/set-debt-ceilings", { data: input });
      return toContent(data, "Set debt ceilings");
    },
  );

  server.registerTool(
    "mercata.lending.pause",
    {
      title: "Pause lending pool",
      description: "Admin: pause lending.",
      inputSchema: z.object({}),
    },
    async () => {
      const data = await client.request("post", "/lending/admin/pause");
      return toContent(data, "Lending paused");
    },
  );

  server.registerTool(
    "mercata.lending.unpause",
    {
      title: "Unpause lending pool",
      description: "Admin: unpause lending.",
      inputSchema: z.object({}),
    },
    async () => {
      const data = await client.request("post", "/lending/admin/unpause");
      return toContent(data, "Lending unpaused");
    },
  );
}

function registerCdpActions(server: McpServer, client: MercataApiClient) {
  const cdpCollateralSchema = z.object({
    asset: z.string(),
    amount: z.string(),
  });
  server.registerTool(
    "mercata.cdp.deposit",
    {
      title: "CDP deposit collateral",
      description: "Deposit collateral into a vault.",
      inputSchema: cdpCollateralSchema,
    },
    async (input: z.infer<typeof cdpCollateralSchema>) => {
      const data = await client.request("post", "/cdp/deposit", { data: input });
      return toContent(data, "CDP deposit");
    },
  );

  server.registerTool(
    "mercata.cdp.withdraw",
    {
      title: "CDP withdraw collateral",
      description: "Withdraw collateral from a vault.",
      inputSchema: cdpCollateralSchema,
    },
    async (input: z.infer<typeof cdpCollateralSchema>) => {
      const data = await client.request("post", "/cdp/withdraw", { data: input });
      return toContent(data, "CDP withdraw");
    },
  );

  const cdpWithdrawMaxSchema = z.object({ asset: z.string() });
  server.registerTool(
    "mercata.cdp.withdraw-max",
    {
      title: "CDP withdraw max",
      description: "Withdraw maximum safe collateral.",
      inputSchema: cdpWithdrawMaxSchema,
    },
    async (input: z.infer<typeof cdpWithdrawMaxSchema>) => {
      const data = await client.request("post", "/cdp/withdraw-max", { data: input });
      return toContent(data, "CDP withdraw max");
    },
  );

  const cdpMintSchema = z.object({
    asset: z.string(),
    amount: z.string(),
  });
  server.registerTool(
    "mercata.cdp.mint",
    {
      title: "CDP mint USDST",
      description: "Mint USDST against collateral.",
      inputSchema: cdpMintSchema,
    },
    async (input: z.infer<typeof cdpMintSchema>) => {
      const data = await client.request("post", "/cdp/mint", { data: input });
      return toContent(data, "CDP mint");
    },
  );

  server.registerTool(
    "mercata.cdp.mint-max",
    {
      title: "CDP mint max",
      description: "Mint maximum safe USDST.",
      inputSchema: z.object({ asset: z.string() }),
    },
    async (input: { asset: string }) => {
      const data = await client.request("post", "/cdp/mint-max", { data: input });
      return toContent(data, "CDP mint max");
    },
  );

  const cdpRepaySchema = z.object({
    asset: z.string(),
    amount: z.string(),
  });
  server.registerTool(
    "mercata.cdp.repay",
    {
      title: "CDP repay",
      description: "Repay USDST debt.",
      inputSchema: cdpRepaySchema,
    },
    async (input: z.infer<typeof cdpRepaySchema>) => {
      const data = await client.request("post", "/cdp/repay", { data: input });
      return toContent(data, "CDP repay");
    },
  );

  server.registerTool(
    "mercata.cdp.repay-all",
    {
      title: "CDP repay all",
      description: "Repay all debt for an asset.",
      inputSchema: z.object({ asset: z.string() }),
    },
    async (input: { asset: string }) => {
      const data = await client.request("post", "/cdp/repay-all", { data: input });
      return toContent(data, "CDP repay all");
    },
  );

  const cdpLiquidateSchema = z.object({
    collateralAsset: z.string(),
    borrower: z.string(),
    debtToCover: z.string(),
  });
  server.registerTool(
    "mercata.cdp.liquidate",
    {
      title: "CDP liquidate",
      description: "Liquidate an unhealthy CDP position.",
      inputSchema: cdpLiquidateSchema,
    },
    async (input: z.infer<typeof cdpLiquidateSchema>) => {
      const data = await client.request("post", "/cdp/liquidate", { data: input });
      return toContent(data, "CDP liquidation");
    },
  );

  const cdpAdminConfigSchema = z.object({
    asset: z.string(),
    liquidationRatio: z.string(),
    liquidationPenaltyBps: z.number().int(),
    closeFactorBps: z.number().int(),
    stabilityFeeRate: z.string(),
    debtFloor: z.string(),
    debtCeiling: z.string(),
    unitScale: z.string(),
    isPaused: z.boolean(),
  });
  server.registerTool(
    "mercata.cdp.set-collateral-config",
    {
      title: "CDP set collateral config",
      description: "Admin: set collateral parameters.",
      inputSchema: cdpAdminConfigSchema,
    },
    async (input: z.infer<typeof cdpAdminConfigSchema>) => {
      const data = await client.request("post", "/cdp/admin/set-collateral-config", { data: input });
      return toContent(data, "CDP collateral config");
    },
  );

  const cdpBatchSchema = z.object({
    assets: z.array(z.string()),
    liquidationRatios: z.array(z.string()),
    liquidationPenaltyBpsArr: z.array(z.string()),
    closeFactorBpsArr: z.array(z.string()),
    stabilityFeeRates: z.array(z.string()),
    debtFloors: z.array(z.string()),
    debtCeilings: z.array(z.string()),
    unitScales: z.array(z.string()),
    pauses: z.array(z.boolean()),
  });
  server.registerTool(
    "mercata.cdp.set-collateral-config-batch",
    {
      title: "CDP batch collateral config",
      description: "Admin: set multiple collateral configs.",
      inputSchema: cdpBatchSchema,
    },
    async (input: z.infer<typeof cdpBatchSchema>) => {
      const data = await client.request("post", "/cdp/admin/set-collateral-config-batch", { data: input });
      return toContent(data, "CDP batch config");
    },
  );

  const cdpPauseSchema = z.object({
    asset: z.string(),
    isPaused: z.boolean(),
  });
  server.registerTool(
    "mercata.cdp.set-asset-paused",
    {
      title: "CDP pause asset",
      description: "Admin: toggle pause for a collateral asset.",
      inputSchema: cdpPauseSchema,
    },
    async (input: z.infer<typeof cdpPauseSchema>) => {
      const data = await client.request("post", "/cdp/admin/set-asset-paused", { data: input });
      return toContent(data, "CDP asset pause");
    },
  );

  const cdpSupportSchema = z.object({
    asset: z.string(),
    supported: z.boolean(),
  });
  server.registerTool(
    "mercata.cdp.set-asset-supported",
    {
      title: "CDP set asset supported",
      description: "Admin: toggle asset support.",
      inputSchema: cdpSupportSchema,
    },
    async (input: z.infer<typeof cdpSupportSchema>) => {
      const data = await client.request("post", "/cdp/admin/set-asset-supported", { data: input });
      return toContent(data, "CDP asset support");
    },
  );

  const cdpGlobalPauseSchema = z.object({ isPaused: z.boolean() });
  server.registerTool(
    "mercata.cdp.set-global-paused",
    {
      title: "CDP global pause",
      description: "Admin: toggle global CDP pause.",
      inputSchema: cdpGlobalPauseSchema,
    },
    async (input: z.infer<typeof cdpGlobalPauseSchema>) => {
      const data = await client.request("post", "/cdp/admin/set-global-paused", { data: input });
      return toContent(data, "CDP global pause");
    },
  );

  const juniorNoteSchema = z.object({
    asset: z.string(),
    amountUSDST: z.string(),
  });
  server.registerTool(
    "mercata.cdp.open-junior-note",
    {
      title: "Open junior note",
      description: "Open a junior note position for bad debt.",
      inputSchema: juniorNoteSchema,
    },
    async (input: z.infer<typeof juniorNoteSchema>) => {
      const data = await client.request("post", "/cdp/bad-debt/open-junior-note", { data: input });
      return toContent(data, "Open junior note");
    },
  );

  const topUpSchema = z.object({ amountUSDST: z.string() });
  server.registerTool(
    "mercata.cdp.top-up-junior-note",
    {
      title: "Top up junior note",
      description: "Add USDST to junior note.",
      inputSchema: topUpSchema,
    },
    async (input: z.infer<typeof topUpSchema>) => {
      const data = await client.request("post", "/cdp/bad-debt/top-up-junior-note", { data: input });
      return toContent(data, "Top up junior note");
    },
  );

  server.registerTool(
    "mercata.cdp.claim-junior-note",
    {
      title: "Claim junior note",
      description: "Claim junior note rewards.",
      inputSchema: z.object({}),
    },
    async () => {
      const data = await client.request("post", "/cdp/bad-debt/claim-junior-note");
      return toContent(data, "Claim junior note");
    },
  );
}

function registerBridgeActions(server: McpServer, client: MercataApiClient) {
  const withdrawSchema = z.object({
    externalChainId: z.string(),
    stratoToken: z.string(),
    stratoTokenAmount: z.string(),
    externalRecipient: z.string(),
    targetStratoToken: z.string().optional(),
  });
  server.registerTool(
    "mercata.bridge.request-withdrawal",
    {
      title: "Bridge request withdrawal",
      description: "Submit a withdrawal request to an external chain.",
      inputSchema: withdrawSchema,
    },
    async (input: z.infer<typeof withdrawSchema>) => {
      const data = await client.request("post", "/bridge/requestWithdrawal", { data: input });
      return toContent(data, "Bridge withdrawal request");
    },
  );

  const autoSaveSchema = z.object({
    externalChainId: z.string(),
    externalTxHash: z.string(),
  });
  server.registerTool(
    "mercata.bridge.request-auto-save",
    {
      title: "Bridge request auto save",
      description: "Request auto save for a bridge transaction.",
      inputSchema: autoSaveSchema,
    },
    async (input: z.infer<typeof autoSaveSchema>) => {
      const data = await client.request("post", "/bridge/requestAutoSave", { data: input });
      return toContent(data, "Bridge auto save");
    },
  );
}

function registerRewardsActions(server: McpServer, client: MercataApiClient) {
  server.registerTool(
    "mercata.rewards.claim",
    {
      title: "Claim Chef rewards",
      description: "Claim all pending CATA rewards from RewardsChef.",
      inputSchema: z.object({}),
    },
    async () => {
      const data = await client.request("post", "/rewards/claim");
      return toContent(data, "Rewards claim");
    },
  );

  server.registerTool(
    "mercata.rewards.claim-all-activities",
    {
      title: "Claim all rewards",
      description: "Claim all rewards across activities.",
      inputSchema: z.object({}),
    },
    async () => {
      const data = await client.request("post", "/rewards/claim-all");
      return toContent(data, "Claim all rewards");
    },
  );

  const claimActivitySchema = z.object({ activityId: z.number().int() });
  server.registerTool(
    "mercata.rewards.claim-activity",
    {
      title: "Claim activity rewards",
      description: "Claim rewards for a specific activity.",
      inputSchema: claimActivitySchema,
    },
    async (input: z.infer<typeof claimActivitySchema>) => {
      const data = await client.request("post", `/rewards/claim/${input.activityId}`);
      return toContent(data, "Claim activity rewards");
    },
  );
}

function registerAdminActions(server: McpServer, client: MercataApiClient) {
  const addAdminSchema = z.object({ userAddress: z.string() });
  server.registerTool(
    "mercata.admin.add-admin",
    {
      title: "Add admin",
      description: "Grant administrator access.",
      inputSchema: addAdminSchema,
    },
    async (input: z.infer<typeof addAdminSchema>) => {
      const data = await client.request("post", "/user/admin", { data: input });
      return toContent(data, "Add admin");
    },
  );

  server.registerTool(
    "mercata.admin.remove-admin",
    {
      title: "Remove admin",
      description: "Revoke administrator access.",
      inputSchema: addAdminSchema,
    },
    async (input: z.infer<typeof addAdminSchema>) => {
      const data = await client.request("delete", "/user/admin", { data: input });
      return toContent(data, "Remove admin");
    },
  );

  const voteSchema = z.object({
    target: z.string(),
    func: z.string(),
    args: z.array(z.string()),
  });
  server.registerTool(
    "mercata.admin.vote",
    {
      title: "Cast vote",
      description: "Cast an administrative vote.",
      inputSchema: voteSchema,
    },
    async (input: z.infer<typeof voteSchema>) => {
      const data = await client.request("post", "/user/admin/vote", { data: input });
      return toContent(data, "Cast vote");
    },
  );

  const voteByIdSchema = z.object({ issueId: z.string() });
  server.registerTool(
    "mercata.admin.vote-by-id",
    {
      title: "Cast vote by issue ID",
      description: "Cast a vote given an issue ID.",
      inputSchema: voteByIdSchema,
    },
    async (input: z.infer<typeof voteByIdSchema>) => {
      const data = await client.request("post", "/user/admin/vote/by-id", { data: input });
      return toContent(data, "Cast vote by ID");
    },
  );

  const dismissSchema = z.object({ issueId: z.string() });
  server.registerTool(
    "mercata.admin.dismiss-issue",
    {
      title: "Dismiss governance issue",
      description: "Dismiss an issue (only proposer only-voter case).",
      inputSchema: dismissSchema,
    },
    async (input: z.infer<typeof dismissSchema>) => {
      const data = await client.request("post", "/user/admin/dismiss", { data: input });
      return toContent(data, "Dismiss issue");
    },
  );
}

function registerOracleActions(server: McpServer, client: MercataApiClient) {
  const priceSchema = z.object({
    token: z.string(),
    price: z.string().describe("Price value (wei)"),
  });
  server.registerTool(
    "mercata.oracle.set-price",
    {
      title: "Set oracle price",
      description: "Admin: set oracle price for an asset.",
      inputSchema: priceSchema,
    },
    async (input: z.infer<typeof priceSchema>) => {
      const data = await client.request("post", "/oracle/price", { data: input });
      return toContent(data, "Set oracle price");
    },
  );
}
