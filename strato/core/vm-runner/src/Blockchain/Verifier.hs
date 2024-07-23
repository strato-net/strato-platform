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
  (MonadFail m) =>
  Bool ->
  OutputBlock ->
  BlockSummary ->
  m ()
checkParentChildValidity _ OutputBlock {obBlockData = c} parentBSum = do
  unless (number c == bSumNumber parentBSum + 1) $
    fail $ "Block number is wrong: got " ++ show (number c) ++ ", expected " ++ show (bSumNumber parentBSum + 1)
  unless (getBlockGasLimit c <= bSumGasLimit parentBSum + nextGasLimitDelta (bSumGasLimit parentBSum)) $
    fail $
      "Block gasLimit is too high: got " ++ show (getBlockGasLimit c)
        ++ ", should be less than "
        ++ show (bSumGasLimit parentBSum + nextGasLimitDelta (bSumGasLimit parentBSum))
  unless (getBlockGasLimit c >= bSumGasLimit parentBSum - nextGasLimitDelta (bSumGasLimit parentBSum)) $
    fail $
      "Block gasLimit is too low: got " ++ show (getBlockGasLimit c)
        ++ ", should be less than "
        ++ show (bSumGasLimit parentBSum - nextGasLimitDelta (bSumGasLimit parentBSum))
  unless (getBlockGasLimit c >= minGasLimit flags_testnet) $
    fail $ "Block gasLimit is lower than minGasLimit: got " ++ show (gasLimit c) ++ ", should be larger than " ++ show (minGasLimit flags_testnet :: Integer)
  return ()

verifyTransactionRoot' :: OutputBlock -> (Bool, MP.StateRoot)
verifyTransactionRoot' OutputBlock {obBlockData = bd, obReceiptTransactions = txs} =
  let tVal = transactionsVerificationValue (otBaseTx <$> txs) in (transactionsRoot bd == tVal, tVal)

verifyTransactionRoot :: HasStateDB m => OutputBlock -> m (Bool, MP.StateRoot)
verifyTransactionRoot OutputBlock {obBlockData = bd, obReceiptTransactions = txs} = do
  sr <- MP.addAllKVs MP.emptyTriePtr $ zip [(0 :: Integer) ..] $ (otBaseTx <$> txs)
  return (transactionsRoot bd == sr, sr)

verifyOmmersRoot :: HasStateDB m => OutputBlock -> m Bool
verifyOmmersRoot OutputBlock {obBlockData = bd, obBlockUncles = bu} = 
    return $ (getBlockOmmersHash bd) == hash (rlpSerialize $ RLPArray $ map rlpEncode $ bu)

checkValidity :: (MonadFail m, HasStateDB m) => Bool -> BlockSummary -> OutputBlock -> m (Maybe String)
checkValidity isHomestead parentBSum b = do
  when (flags_transactionRootVerification) $ do
    trVerified <- verifyTransactionRoot b
    let trVerifiedMem = verifyTransactionRoot' b

    when (not (fst trVerifiedMem)) $ error "memTransactionRoot doesn't match transactions"
    when (not (fst trVerified)) $ error "transactionRoot doesn't match transactions"

  ommersVerified <- verifyOmmersRoot b
  when (not ommersVerified) $ error "ommersRoot doesn't match uncles"
  checkParentChildValidity isHomestead b parentBSum
  pure Nothing

isNonceValid :: (Account `A.Alters` AddressState) f => OutputTx -> f Bool
isNonceValid ot@OutputTx {otSigner = txAddr} =
  let base = fromMaybe (otBaseTx ot) (otPrivatePayload ot)
      tNonce = transactionNonce base
   in (== tNonce) . addressStateNonce <$> A.lookupWithDefault A.Proxy (Account txAddr (txChainId base))
