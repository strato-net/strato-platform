import { usdstAddress } from '@/lib/constants';
import { parseJsonBigInt } from '@/utils/numberUtils';

// A deployment is a fixed sequence of admin actions with every value filled in, so an admin
// only confirms each one. Votes go through the AdminRegistry (one issue per
// target/function/args; the same call from every admin lands on the same issue). Contract
// creations are issues too, but their source is the argument, so one admin raises them with
// the deploy script and the rest approve by issue id. Steps that are a plain transaction by
// a single key are shown as the command to run.

export type DeploymentArg = { label: string; type: 'address' | 'string' | 'int'; value: string | null };

export type DeploymentStep =
  | { kind: 'vote'; title: string; why: string; target: string; targetName: string; func: string; args: DeploymentArg[] }
  | { kind: 'create'; title: string; why: string; contractName: string; command: string }
  | { kind: 'manual'; title: string; why: string; command: string };

export type Network = 'helium' | 'upquark';

export type Deployment = {
  id: string;
  title: string;
  description: string;
  steps: (network: Network) => DeploymentStep[];
};

const ADMIN_REGISTRY = '000000000000000000000000000000000000100c';

type StratoGasValues = {
  strato: string;
  burnableLogic: string | null;
  pool: string | null;
  router: string | null;
  routerName: string;
  poolV3Factory: string;
  // isqrt(usdstPerStrato * 2^192 / 1e18): the pool's opening price.
  initialSqrtPriceX96: string | null;
};

// null = not known yet: the step shows what it is waiting on and cannot be approved.
const STRATO_GAS_VALUES: Record<Network, StratoGasValues> = {
  helium: {
    strato: '8ee9a3391e38176feebf5d43cb2c1d6c4f728b04',
    burnableLogic: '646cdf8ec887a23dd6fe007280909c36c994cb04',
    pool: '6df32c9b8012794dc7d02bca289d918bb4633165',
    router: 'b01ce4cc3f3735dcc7f20fbb413407dce92b6aec',
    routerName: 'HeliumFeeRouterV6',
    poolV3Factory: 'e6b6f05a88e649e4102a801aade9a6bae02f352d',
    initialSqrtPriceX96: '75369070124257090245618286035', // 0.9050 USDST per STRATO
  },
  upquark: {
    strato: '2ca3e170e6714282da77815f7864b17f612f5f83',
    burnableLogic: null,
    pool: null,
    router: null,
    routerName: 'UpquarkFeeRouter',
    poolV3Factory: '5d630126d908b46bcf8d00bc15e591a459375809',
    initialSqrtPriceX96: null,
  },
};

const stratoGasSteps = (network: Network): DeploymentStep[] => {
  const v = STRATO_GAS_VALUES[network];
  const strato: DeploymentArg = { label: 'token', type: 'address', value: v.strato };
  return [
    {
      kind: 'vote',
      title: 'Upgrade STRATO to the burnable logic',
      why: 'Adds burn(uint256) so the fee hook can destroy the signer\'s own STRATO. Holders cannot burn anyone else\'s.',
      target: v.strato,
      targetName: 'STRATO token proxy',
      func: 'setLogicContract',
      args: [{ label: 'logic', type: 'address', value: v.burnableLogic }],
    },
    {
      kind: 'create',
      title: 'Deploy the fee router',
      why: 'The router prices each block from the pool\'s 30-minute average and charges a voucher, else STRATO. One admin raises the creation with the deploy script; everyone else approves it here.',
      contractName: v.routerName,
      command: `FEE_ROUTER_NAME=${v.routerName} node deploy-feerouter.js`,
    },
    {
      kind: 'vote',
      title: 'Create the STRATO/USDST pool',
      why: 'The canonical pool the router prices from. Opens at the oracle price so the first quote matches the legacy fee.',
      target: v.poolV3Factory,
      targetName: 'PoolV3 factory',
      func: 'createPoolV3',
      args: [
        { label: 'tokenA', type: 'address', value: v.strato },
        { label: 'tokenB', type: 'address', value: usdstAddress },
        { label: 'fee', type: 'int', value: '3000' },
        { label: 'initialSqrtPriceX96', type: 'int', value: v.initialSqrtPriceX96 },
      ],
    },
    {
      kind: 'manual',
      title: 'Seed the pool',
      why: 'Full-range liquidity from the treasury key, before transfers are paused: minting into the pool needs transferFrom.',
      command: `node strato-gas-helium.js seed-pool ${v.pool ?? '<pool>'} 100000`,
    },
    {
      kind: 'vote',
      title: 'Let the router move fees while STRATO is paused',
      why: 'The pause whitelist is keyed on the caller. The router pulls the fee from the signer with transferFrom.',
      target: ADMIN_REGISTRY,
      targetName: 'AdminRegistry',
      func: 'addWhitelist',
      args: [strato, { label: 'function', type: 'string', value: 'transferFrom' }, { label: 'router', type: 'address', value: v.router }],
    },
    {
      kind: 'vote',
      title: 'Let the pool pay out STRATO to swappers',
      why: 'USDST buys STRATO through the pool, including the router\'s shortfall buy for USDST-only signers. Selling into the pool stays blocked.',
      target: ADMIN_REGISTRY,
      targetName: 'AdminRegistry',
      func: 'addWhitelist',
      args: [strato, { label: 'function', type: 'string', value: 'transfer' }, { label: 'pool', type: 'address', value: v.pool }],
    },
    {
      kind: 'vote',
      title: 'Pause STRATO transfers until TGE',
      why: 'Fees and pool buys keep working through the whitelist above; everything else waits for TGE.',
      target: v.strato,
      targetName: 'STRATO token proxy',
      func: 'pause',
      args: [],
    },
    {
      kind: 'manual',
      title: 'Install the router',
      why: 'DeciderState names the fee contract. Its owner is a single key, so this is one transaction, not a vote.',
      command: `node install-feerouter.js install ${v.router ?? '<router>'}`,
    },
  ];
};

export const DEPLOYMENTS: Deployment[] = [
  {
    id: 'strato-gas',
    title: 'STRATO as gas',
    description: 'Fees paid in STRATO, priced per block from the STRATO/USDST pool, with transfers paused until TGE.',
    steps: stratoGasSteps,
  },
];

export const normalizeArg = (value: unknown): string => String(value ?? '').toLowerCase().replace(/^0x/, '');

// Issue args arrive as a JSON string from Cirrus or as an array from the API. Some strings
// do not parse (a contract source, say); those issues simply match no step.
const issueArgs = (issue: { args: unknown }): unknown[] => {
  const raw = typeof issue.args === 'string' ? parseJsonBigInt(issue.args, { fallback: [] }) : issue.args;
  return Array.isArray(raw) ? raw : [];
};

export type RegistryIssue = { issueId: string; target: string; func: string; args: unknown };

export type RegistryState = {
  issues: RegistryIssue[];
  votes: Array<{ issueId: string; voter: string }>;
  // From the executed lookup: issues for the deployments' target/function pairs, and the
  // names of contracts that exist.
  executed: RegistryIssue[];
  created: string[];
  admins: Array<{ address: string }>;
  globalThreshold: number;
  thresholds: Array<{ target: string; func: string; threshold: number }>;
};

export const issueForStep = <T extends RegistryIssue>(step: DeploymentStep, issues: T[]): T | undefined => {
  if (step.kind === 'manual') return undefined;
  return issues.find((issue) => {
    const args = issueArgs(issue);
    if (step.kind === 'create') return issue.func === 'createContract' && args[0] === step.contractName;
    return (
      normalizeArg(issue.target) === step.target &&
      issue.func === step.func &&
      args.length === step.args.length &&
      step.args.every((arg, i) => normalizeArg(args[i]) === normalizeArg(arg.value))
    );
  });
};

export const votesNeeded = (state: RegistryState, issue: RegistryIssue): number => {
  const own = state.thresholds.find((t) => normalizeArg(t.target) === normalizeArg(issue.target) && t.func === issue.func)?.threshold;
  return Math.ceil((state.admins.length * (own || state.globalThreshold)) / 10000);
};

// What castVoteOnIssue sends: addresses 0x-prefixed, everything else as typed in.
export const voteArgs = (step: Extract<DeploymentStep, { kind: 'vote' }>): string[] =>
  step.args.map((arg) => (arg.type === 'address' ? `0x${arg.value}` : String(arg.value)));

export const missingValue = (step: DeploymentStep): string | null => {
  if (step.kind !== 'vote') return null;
  const missing = step.args.find((arg) => arg.value === null);
  return missing ? missing.label : null;
};

export type StepStatus = { executed: boolean; openIssue?: RegistryIssue; votesCast: number; voted: boolean };

export const stepStatus = (step: DeploymentStep, state: RegistryState, userAddress: string | null): StepStatus => {
  const executed = step.kind === 'create' ? state.created.includes(step.contractName) : Boolean(issueForStep(step, state.executed));
  const openIssue = executed ? undefined : issueForStep(step, state.issues);
  const votes = openIssue ? state.votes.filter((v) => v.issueId === openIssue.issueId) : [];
  return { executed, openIssue, votesCast: votes.length, voted: votes.some((v) => normalizeArg(v.voter) === normalizeArg(userAddress)) };
};
