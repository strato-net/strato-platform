{-# LANGUAGE OverloadedStrings #-}

-- | Centralized fork-block constants for STRATO consensus-affecting changes.
--
-- Each fork is a tuple of (network ID, fork block number). Outside the named
-- network, the new behavior is enabled from genesis. Inside the named network,
-- old behavior holds for blocks strictly less than the fork block; new behavior
-- takes effect at and after.
--
-- Helium's staking forks share a single height (see heliumStakingForkBlock):
-- they ship in one binary, so they cannot be rolled back independently, and
-- their failure modes are already distinct (StakeMismatch vs
-- ReceiptsRootMismatch). One flag day is easier to run than two.
--
-- Existing inline fork constants in the SolidVM tree (heliumPassByRefForkBlock,
-- heliumToBasicForkBlock) predate this module and continue to live alongside
-- their use sites. New consensus forks should be added here so they're easy to
-- find and audit.
module Blockchain.Forks
  ( isReceiptsRootForkActive,
    isBlockRewardReceiptForkActive
  )
where

import Blockchain.EthConf (ethConf)
import qualified Blockchain.EthConf.Model as Conf
import Blockchain.EthConf.Model (networkConfig)

heliumNetworkID :: Integer
heliumNetworkID = 114784819836269

upquarkNetworkID :: Integer
upquarkNetworkID = 33056204878082667

-- | Throwaway network for rehearsing the staking/receipts-root flag day before
-- it runs on a live chain. Its forks sit at a low height on purpose: the point
-- is to exercise the legacy paths, the transition, and the post-fork paths in
-- one short-lived chain. Unlike helium and upquark, this network is created
-- after the fork code exists, so without an entry here it would run the new
-- rules from genesis and never test the old ones at all.
forktestNetworkID :: Integer
forktestNetworkID = 7381244120123405172

forktestForkBlock :: Integer
forktestForkBlock = 10000

heliumReceiptsRootForkBlock :: Integer
heliumReceiptsRootForkBlock = 250000

isReceiptsRootForkActive :: Integer -> Bool
isReceiptsRootForkActive blockNum =
  let net = Conf.networkID $ networkConfig ethConf
   in not $ (net == upquarkNetworkID  && blockNum < upquarkStakingForkBlock)
         || (net == heliumNetworkID   && blockNum < heliumReceiptsRootForkBlock)
         || (net == forktestNetworkID && blockNum < forktestForkBlock)

-- | Block from which the block-reward call's events are folded into the block's
-- first receipt, so BlockRewardsPaid is visible to receipts and the indexer.
--
-- It needs a height because receipts roots are live in the header: adding a log
-- moves the root, so proposer and verifier have to start doing it at the same
-- block. Helium has already produced reward-paying blocks whose receipts omit
-- the event, so it gets its own switch height. Every other network switches when
-- staking activates — which is before it can ever pay a block reward, so no
-- network but helium has a window to reconcile.
--
-- Shared with the stake-event switch (stakingEventsFromGovernanceBlock in
-- strato-conf); keep the two in step.
heliumStakingForkBlock :: Integer
heliumStakingForkBlock = 300000

upquarkStakingForkBlock :: Integer
upquarkStakingForkBlock = 1000000

isBlockRewardReceiptForkActive :: Integer -> Bool
isBlockRewardReceiptForkActive blockNum =
  let conf = networkConfig ethConf
      switchAt
        | Conf.networkID conf == upquarkNetworkID = upquarkStakingForkBlock
        | Conf.networkID conf == heliumNetworkID = heliumStakingForkBlock
        -- 'Nothing' means staking is live from genesis, so the fork is too.
        | otherwise = maybe 0 id (Conf.stakingActivationBlock conf)
   in blockNum >= switchAt
