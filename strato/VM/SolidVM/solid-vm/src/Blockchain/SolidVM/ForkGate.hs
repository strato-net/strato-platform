{-# LANGUAGE FlexibleContexts #-}

-- | Runtime wrapper around 'Blockchain.VM.ForkGate' that resolves the
-- network id from 'Blockchain.EthConf' and the current block number from
-- the VM environment. Re-exports the pure module for convenience.
module Blockchain.SolidVM.ForkGate
  ( module Blockchain.VM.ForkGate,
    auditForkActive,
  )
where

import qualified Blockchain.Data.BlockHeader as BlockHeader
import Blockchain.EthConf (ethConf, networkConfig)
import qualified Blockchain.EthConf.Model as Conf
import qualified Blockchain.SolidVM.Environment as Env
import Blockchain.SolidVM.SM (MonadSM, getEnv)
import Blockchain.VM.ForkGate

-- | Is the audit-fix hard-fork active for the currently-executing block?
-- Reads the network id from the global 'ethConf' and the block number
-- from the VM environment.
auditForkActive :: MonadSM m => m Bool
auditForkActive = do
  env' <- getEnv
  let blockNum = BlockHeader.number (Env.blockHeader env')
      nid = Conf.networkID (networkConfig ethConf)
  pure $ isAuditForkActive nid blockNum
