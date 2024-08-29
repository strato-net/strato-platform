{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Verifier
  ( checkValidity,
    isNonceValid,
  )
where

import Blockchain.Constants
import Blockchain.DB.StateDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.BlockHeader
import Blockchain.Data.BlockSummary
import Blockchain.Data.RLP
import Blockchain.Data.Transaction
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Sequencer.Event
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Options
import Blockchain.VMOptions
import Blockchain.Verification
import Control.Monad
import qualified Control.Monad.Change.Alter as A
import Data.Maybe (fromMaybe)


nextGasLimitDelta :: Integer -> Integer
nextGasLimitDelta oldGasLimit = oldGasLimit `div` 1024

-- checkUnclesHash::OutputBlock->Bool
-- checkUnclesHash OutputBlock{obBlockData=bd,obBlockUncles=bus} =
--     ommersHash bd == hash (rlpSerialize $ RLPArray (rlpEncode <$> bus))

checkParentChildValidity ::
  OutputBlock ->
  BlockSummary ->
  m (Maybe BlockVerificationFailureDetails)
checkParentChildValidity OutputBlock {obBlockData = c} parentBSum = do
  if (number c == bSumNumber parentBSum + 1) $
    return Nothing
  else 
    return UnexpectedBlockNumber (BlockDelta (number c) (bSumNumber parentBSum + 1))

verifyTransactionRoot' :: OutputBlock -> (Bool, MP.StateRoot)
verifyTransactionRoot' OutputBlock {obBlockData = bd, obReceiptTransactions = txs} =
  let tVal = transactionsVerificationValue (otBaseTx <$> txs) in (transactionsRoot bd == tVal, tVal)

verifyTransactionRoot :: HasStateDB m => OutputBlock -> m (Bool, MP.StateRoot)
verifyTransactionRoot OutputBlock {obBlockData = bd, obReceiptTransactions = txs} = do
  sr <- MP.addAllKVs MP.emptyTriePtr $ zip [(0 :: Integer) ..] $ (otBaseTx <$> txs)
  return (transactionsRoot bd == sr, sr)

verifyOmmersRoot :: HasStateDB m => OutputBlock -> m (Maybe BlockVerificationFailureDetails)
verifyOmmersRoot OutputBlock {obBlockData = bd, obBlockUncles = bu} = 
  let inBlockOmmersHash = getBlockOmmersHash bd
      derivedOmmersHash = hash (rlpSerialize $ RLPArray $ map rlpEncode $ bu)
  return $ case inBlockOmmersHash == derivedOmmersHash of 
    True -> UnclesMismatch (BlockDelta inBlockOmmersHash derivedOmmersHash)
    False -> Nothing

checkValidity :: (HasStateDB m) => BlockSummary -> OutputBlock -> m [BlockVerificationFailureDetails]
checkValidity parentBSum b = do
  -- for some reason transactionRootVerification is always false so not handling this case
  -- when (flags_transactionRootVerification) $ do
  --   trVerified <- verifyTransactionRoot b
  --   let trVerifiedMem = verifyTransactionRoot' b

  --   when (not (fst trVerifiedMem)) $ error "memTransactionRoot doesn't match transactions"
  --   when (not (fst trVerified)) $ error "transactionRoot doesn't match transactions"

  ommersVerified <- verifyOmmersRoot b
  blockNumberVerified <- checkParentChildValidity b parentBSum
  pure $ catMaybes [ommersVerified : blockNumberVerified]

isNonceValid :: (Account `A.Alters` AddressState) f => OutputTx -> f Bool
isNonceValid ot@OutputTx {otSigner = txAddr} =
  let base = fromMaybe (otBaseTx ot) (otPrivatePayload ot)
      tNonce = transactionNonce base
   in (== tNonce) . addressStateNonce <$> A.lookupWithDefault A.Proxy (Account txAddr (txChainId base))
