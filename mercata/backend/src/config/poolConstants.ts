export const poolConstants = () => {
  const CONTRACT_PREFIX = "BlockApps-Mercata-";
  const Token = `${CONTRACT_PREFIX}Token`;
  const Pool = `${CONTRACT_PREFIX}Pool`;
  const PoolFactory = `${CONTRACT_PREFIX}PoolFactory`;
  const PoolSwap = `${CONTRACT_PREFIX}Pool-Swap`;

  const poolTokenSelectFields = [
    "address",
    "_name",
    "_symbol",
    "_totalSupply::text",
    "customDecimals",
    `balances:${Token}-_balances(user:key,balance:value::text)`,
  ];

  const poolSelectFields = [
    "address",
    "swapFeeRate",
    "lpSharePercent",
    "aToBRatio::text", 
    "bToARatio::text",
    `tokenA:tokenA_fkey(${poolTokenSelectFields.join(',')})`,
    "tokenABalance::text",
    `tokenB:tokenB_fkey(${poolTokenSelectFields.join(',')})`,
    "tokenBBalance::text",
    `lpToken:lpToken_fkey(${poolTokenSelectFields.join(',')})`,
  ];

  return {
    Pool,
    PoolFactory,
    PoolSwap,
    poolTokenSelectFields,
    poolSelectFields,
  };
};
