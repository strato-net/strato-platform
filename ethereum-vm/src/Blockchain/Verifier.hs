{-# LANGUAGE OverloadedStrings, FlexibleContexts #-}

module Blockchain.Verifier (
  checkValidity,
  isNonceValid
  ) where

import Control.Monad
import Control.Monad.Trans.Resource

import Blockchain.Constants
import Blockchain.Data.AddressStateDB
import Blockchain.Data.BlockSummary
import Blockchain.Data.BlockDB
import Blockchain.Data.RLP
import Blockchain.Data.Transaction
import qualified Blockchain.Database.MerklePatricia.Internal as MP
import Blockchain.DB.MemAddressStateDB
import Blockchain.DB.StateDB
import Blockchain.Mining
import Blockchain.Mining.Normal
import Blockchain.Mining.Instant
import Blockchain.Mining.SHA
import Blockchain.Sequencer.Event
import Blockchain.SHA
import Blockchain.Util
import Blockchain.VMContext
import Blockchain.VMOptions
import Blockchain.Verification


--import Debug.Trace

{-
nextGasLimit::Integer->Integer->Integer
nextGasLimit oldGasLimit oldGasUsed = max (max 125000 3141592) ((oldGasLimit * 1023 + oldGasUsed *6 `quot` 5) `quot` 1024)
-}

nextGasLimitDelta::Integer->Integer
nextGasLimitDelta oldGasLimit  = oldGasLimit `div` 1024

checkUnclesHash::OutputBlock->Bool
checkUnclesHash OutputBlock{obBlockData=bd,obBlockUncles=bus} =
    blockDataUnclesHash bd == hash (rlpSerialize $ RLPArray (rlpEncode <$> bus))

--data BlockValidityError = BlockDifficultyWrong Integer Integer | BlockNumberWrong Integer Integer | BlockGasLimitWrong Integer Integer | BlockNonceWrong | BlockUnclesHashWrong
{-
instance Format BlockValidityError where
    --format BlockOK = "Block is valid"
    format (BlockDifficultyWrong d expected) = "Block difficulty is wrong, is '" ++ show d ++ "', expected '" ++ show expected ++ "'"
-}

checkParentChildValidity::(Monad m)=>Bool->OutputBlock->BlockSummary->m ()
checkParentChildValidity isHomestead OutputBlock{obBlockData=c} parentBSum = do
    let nextDifficulty' = if isHomestead then homesteadNextDifficulty else nextDifficulty
    unless (blockDataDifficulty c == nextDifficulty' flags_testnet (bSumNumber parentBSum) (bSumDifficulty parentBSum) (bSumTimestamp parentBSum) (blockDataTimestamp c))
             $ fail $ "Block difficulty is wrong: got '" ++ show (blockDataDifficulty c) ++
                   "', expected '" ++
                   show (nextDifficulty' flags_testnet (bSumNumber parentBSum) (bSumDifficulty parentBSum) (bSumTimestamp parentBSum) (blockDataTimestamp c)) ++ "'"
    unless (blockDataNumber c == bSumNumber parentBSum + 1) 
             $ fail $ "Block number is wrong: got '" ++ show (blockDataNumber c) ++ ", expected '" ++ show (bSumNumber parentBSum + 1) ++ "'"
    unless (blockDataGasLimit c <= bSumGasLimit parentBSum +  nextGasLimitDelta (bSumGasLimit parentBSum))
             $ fail $ "Block gasLimit is too high: got '" ++ show (blockDataGasLimit c) ++
                   "', should be less than '" ++ show (bSumGasLimit parentBSum +  nextGasLimitDelta (bSumGasLimit parentBSum)) ++ "'"
    unless (blockDataGasLimit c >= bSumGasLimit parentBSum - nextGasLimitDelta (bSumGasLimit parentBSum))
             $ fail $ "Block gasLimit is too low: got '" ++ show (blockDataGasLimit c) ++
                   "', should be less than '" ++ show (bSumGasLimit parentBSum -  nextGasLimitDelta (bSumGasLimit parentBSum)) ++ "'"
    unless (blockDataGasLimit c >= minGasLimit flags_testnet)
             $ fail $ "Block gasLimit is lower than minGasLimit: got '" ++ show (blockDataGasLimit c) ++ "', should be larger than " ++ show (minGasLimit flags_testnet::Integer)
    return ()

verifier::Miner
verifier = (if (flags_miner == Normal) then normalMiner else if(flags_miner == Instant) then instantMiner else shaMiner)

addAllKVs::RLPSerializable obj=>MonadResource m=>MP.MPDB->[(Integer, obj)]->m MP.MPDB
addAllKVs x [] = return x
addAllKVs mpdb (x:rest) = do
  mpdb' <- MP.unsafePutKeyVal mpdb (byteString2NibbleString $ rlpSerialize $ rlpEncode $ fst x) (rlpEncode $ rlpSerialize $ rlpEncode $ snd x)
  addAllKVs mpdb' rest

verifyTransactionRoot'::OutputBlock -> (Bool,MP.StateRoot)
verifyTransactionRoot' OutputBlock{obBlockData=bd,obReceiptTransactions=txs} =
    let tVal = transactionsVerificationValue (otBaseTx <$> txs) in (blockDataTransactionsRoot bd == tVal, tVal)

verifyTransactionRoot::(MonadResource m, HasStateDB m)=>OutputBlock->m (Bool,MP.StateRoot)
verifyTransactionRoot OutputBlock{obBlockData=bd,obReceiptTransactions=txs} = do
  mpdb <- getStateDB

  MP.MPDB{MP.stateRoot=sr} <- addAllKVs mpdb{MP.stateRoot=MP.emptyTriePtr} $ zip [0..] $ (otBaseTx <$> txs)
  return (blockDataTransactionsRoot bd == sr, sr)

verifyOmmersRoot::(MonadResource m, HasStateDB m)=>OutputBlock->m Bool
verifyOmmersRoot OutputBlock{obBlockData=bd, obBlockUncles=bu} = return $ blockDataUnclesHash bd == hash (rlpSerialize $ RLPArray $ map rlpEncode $ bu)

checkValidity::Monad m=>Bool->Bool->BlockSummary->OutputBlock->ContextM (m ())
checkValidity partialBlock isHomestead parentBSum b = do
  when (flags_transactionRootVerification) $ do
           trVerified <- verifyTransactionRoot b
           let trVerifiedMem = verifyTransactionRoot' b

           when (not (fst trVerifiedMem)) $ error "memTransactionRoot doesn't match transactions" 
           when (not (fst trVerified)) $ error "transactionRoot doesn't match transactions"


  ommersVerified <- verifyOmmersRoot b
  when (not ommersVerified) $ error "ommersRoot doesn't match uncles"
  checkParentChildValidity isHomestead b parentBSum
  when (flags_miningVerification && not partialBlock) $ do
    let miningVerified = (verify verifier) (outputBlockToBlock b) -- todo: dont wanna rewrite adit just yet
    unless miningVerified $ fail "block falsely mined, verification failed"
  --nIsValid <- nonceIsValid' b
  --unless nIsValid $ fail $ "Block nonce is wrong: " ++ format b
  unless (checkUnclesHash b) $ fail "Block unclesHash is wrong"
  return $ return ()


{-
                    coinbase=prvKey2Address prvKey,
        stateRoot = SHA 0x9b109189563315bfeb13d4bfd841b129ff3fd5c85f228a8d9d8563b4dde8432e,
                    transactionsTrie = 0,
-}

isNonceValid :: OutputTx -> ContextM Bool
isNonceValid OutputTx{otBaseTx=base, otSigner=txAddr} = do
  let txNonce = transactionNonce base
  addressState <- getAddressState txAddr
  return $ addressStateNonce addressState == txNonce
