{-# LANGUAGE OverloadedStrings #-}

-- | Centralized fork-block constants for STRATO consensus-affecting changes.
--
-- Each fork is a tuple of (network ID, fork block number). Outside the named
-- network, the new behavior is enabled from genesis. Inside the named network,
-- old behavior holds for blocks strictly less than the fork block; new behavior
-- takes effect at and after.
--
-- Existing inline fork constants in the SolidVM tree (heliumPassByRefForkBlock,
-- heliumToBasicForkBlock) predate this module and continue to live alongside
-- their use sites. New consensus forks should be added here so they're easy to
-- find and audit.
module Blockchain.Forks
  ( heliumNetworkID,
    receiptsRootForkBlock,
    isReceiptsRootForkActive,
  )
where

import Blockchain.EthConf (ethConf)
import qualified Blockchain.EthConf.Model as Conf
import Blockchain.EthConf.Model (networkConfig)

-- | Helium (Mercata) mainnet network identifier.
heliumNetworkID :: Integer
heliumNetworkID = 114784819836269

-- | Block height at which the receipts-trie root becomes consensus-critical
-- on Helium. Before this height the header carries the empty-trie sentinel
-- (legacy behavior); at and after it the root is computed from the actual
-- receipts of the executed transactions.
--
-- TODO: pick the real fork block once validator coordination is scheduled.
-- The current value is a far-future placeholder.
receiptsRootForkBlock :: Integer
receiptsRootForkBlock = 1000000

-- | Is the receipts-root fork active for the given block number?
--
-- Helium nodes follow the legacy behavior up to but not including the fork
-- block, then switch to the new behavior. All other networks use the new
-- behavior unconditionally — there's no legacy data to preserve there.
isReceiptsRootForkActive :: Integer -> Bool
isReceiptsRootForkActive blockNum =
  not (Conf.networkID (networkConfig ethConf) == heliumNetworkID && blockNum < receiptsRootForkBlock)
