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
import Blockchain.Data.Transaction
import Blockchain.Sequencer.Event
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Keccak256
import Blockchain.Event 
import qualified Control.Monad.Change.Alter as A
import Data.Maybe (fromMaybe, catMaybes)


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

-- verifyTransactionRoot' :: Block -> (Bool, MP.StateRoot)
-- verifyTransactionRoot' Block {blockBlockData = bd, blockReceiptTransactions = txs} =
--   let tVal = transactionsVerificationValue (otBaseTx <$> txs) in (transactionsRoot bd == tVal, tVal)

-- verifyTransactionRoot :: HasStateDB m => Block -> m (Bool, MP.StateRoot)
-- verifyTransactionRoot Block {blockBlockData = bd, blockReceiptTransactions = txs} = do
--   sr <- MP.addAllKVs MP.emptyTriePtr $ zip [(0 :: Integer) ..] $ (otBaseTx <$> txs)
--   return (transactionsRoot bd == sr, sr)

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
  return $ catMaybes [ommersVerified, blockNumberVerified]

isNonceValid :: (Account `A.Alters` AddressState) f => OutputTx -> f Bool
isNonceValid ot@OutputTx {otSigner = txAddr} =
  let base = fromMaybe (otBaseTx ot) (otPrivatePayload ot)
      tNonce = transactionNonce base
   in (== tNonce) . addressStateNonce <$> A.lookupWithDefault A.Proxy (Account txAddr (txChainId base))
