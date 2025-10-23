{-# LANGUAGE TemplateHaskell #-}

module Blockchain.GenesisBlocks.Contracts.Mercata where

mercataContractFiles :: [String]
mercataContractFiles = [
  "contracts/abstract/ERC20/ERC20.sol",
  "contracts/abstract/ERC20/IERC20.sol",
  "contracts/abstract/ERC20/access/Authorizable.sol",
  "contracts/abstract/ERC20/access/Ownable.sol",
  "contracts/abstract/ERC20/extensions/IERC20Metadata.sol",
  "contracts/abstract/ERC20/utils/Context.sol",
  "contracts/abstract/ERC20/utils/Pausable.sol",
  "contracts/concrete/Admin/AdminRegistry.sol",
  "contracts/concrete/Admin/FeeCollector.sol",
  "contracts/concrete/BaseCodeCollection.sol",
  "contracts/concrete/Bridge/MercataBridge.sol",
  "contracts/concrete/CDP/CDPEngine.sol",
  "contracts/concrete/CDP/CDPRegistry.sol",
  "contracts/concrete/CDP/CDPVault.sol",
  "contracts/concrete/CDP/CDPReserve.sol",
  "contracts/concrete/Enums/RestStatus.sol",
  "contracts/concrete/Lending/CollateralVault.sol",
  "contracts/concrete/Lending/LendingPool.sol",
  "contracts/concrete/Lending/LendingRegistry.sol",
  "contracts/concrete/Lending/LiquidityPool.sol",
  "contracts/concrete/Lending/PoolConfigurator.sol",
  "contracts/concrete/Lending/PriceOracle.sol",
  "contracts/concrete/Lending/RateStrategy.sol",
  "contracts/concrete/Lending/SafetyModule.sol",
  "contracts/concrete/Pools/Pool.sol",
  "contracts/concrete/Pools/PoolFactory.sol",
  "contracts/concrete/Proxy/Proxy.sol",
  "contracts/concrete/Rewards/RewardsChef.sol",
  "contracts/concrete/Tokens/Token.sol",
  "contracts/concrete/Tokens/TokenFactory.sol",
  "contracts/concrete/Tokens/TokenMetadata.sol",
  "contracts/concrete/Voucher/Voucher.sol"
  ]