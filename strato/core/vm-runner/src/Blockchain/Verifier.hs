{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Verifier where

import Blockchain.DB.StateDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader
import Blockchain.Data.BlockSummary
import Blockchain.Data.RLP
import qualified Blockchain.Data.TransactionDef as TD
import Blockchain.Model.WrappedBlock
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import Blockchain.Event
import qualified Control.Monad.Change.Alter as A
import Data.Maybe (catMaybes)


nextGasLimitDelta :: Integer -> Integer
nextGasLimitDelta oldGasLimit = oldGasLimit `div` 1024

checkParentChildValidity ::
  Block ->
  BlockSummary ->
  Maybe BlockVerificationFailureDetails
checkParentChildValidity Block {blockBlockData = c} parentBSum = do
  if (number c == bSumNumber parentBSum + 1)
    then Nothing
    else Just $ UnexpectedBlockNumber (BlockDelta (number c) (bSumNumber parentBSum + 1))

-- | A block may not be stamped before its parent. Non-decreasing (@>=@) rather
-- than strictly increasing: stamps have one-second resolution and blockPeriodMs
-- may be sub-second, so two honest consecutive blocks can share a second.
--
-- Deterministic, so it runs wherever 'verifyBlock' does: the pre-prepare replay
-- that decides a validator's vote, block insertion, and sync. It is not gated
-- on a fork height: nothing constrained the field before, so a live network's
-- history has to satisfy the rule already for a fresh node to sync, and syncing
-- one is how that is verified. Should a chain turn out to hold an out-of-order
-- pair, the height in the TimestampBeforeParent report is where to gate this
-- check (see Blockchain.Forks for the pattern).
--
-- The comparison against the local clock is deliberately not here; it lives in
-- Blockstanbul (checkProposalTimestamp) and runs only while voting.
checkTimestampMonotonic ::
  Block ->
  BlockSummary ->
  Maybe BlockVerificationFailureDetails
checkTimestampMonotonic Block {blockBlockData = c} parentBSum
  | timestamp c >= bSumTimestamp parentBSum = Nothing
  | otherwise = Just $ TimestampBeforeParent (BlockDelta (timestamp c) (bSumTimestamp parentBSum))

verifyOmmersRoot :: HasStateDB m => Block -> m (Maybe BlockVerificationFailureDetails)
verifyOmmersRoot Block {blockBlockData = bd, blockBlockUncles = bu} =
  let inBlockOmmersHash = getBlockOmmersHash bd
      derivedOmmersHash = hash (rlpSerialize $ RLPArray $ map rlpEncode $ bu)
  in if inBlockOmmersHash /= derivedOmmersHash
        then return $ Just $ UnclesMismatch (BlockDelta inBlockOmmersHash derivedOmmersHash)
        else return Nothing

checkValidity :: HasStateDB m => BlockSummary -> Block -> m [BlockVerificationFailureDetails]
checkValidity parentBSum b = do
  ommersVerified <- verifyOmmersRoot b
  let blockNumberVerified = checkParentChildValidity b parentBSum
      timestampVerified = checkTimestampMonotonic b parentBSum
  return $ catMaybes [ommersVerified, blockNumberVerified, timestampVerified]

isNonceValid :: (Address `A.Alters` AddressState) f => OutputTx -> f Bool
isNonceValid ot@OutputTx {otSigner = txAddr} =
  let tNonce = TD.nonce $ otBaseTx ot
   in (== tNonce) . addressStateNonce <$> A.lookupWithDefault A.Proxy txAddr
