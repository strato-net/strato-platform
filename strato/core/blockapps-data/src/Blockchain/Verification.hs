{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators     #-}

module Blockchain.Verification (
  transactionsVerificationValue,
  ommersVerificationValue,
  receiptsVerificationValue
  ) where

import           Prelude.Unicode

import qualified Control.Monad.Change.Alter         as A
import           Blockchain.Data.DataDefs
import           Blockchain.Data.RLP
import           Blockchain.Data.Transaction
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Util

import           Data.Functor.Identity

{-
transactionsVerificationValue::[Transaction]->MP.StateRoot
transactionsVerificationValue = MP.sha2StateRoot . listToRLPVerificationValue
-}


addAllKVsMem :: (RLPSerializable obj, (MP.StateRoot `A.Alters` MP.NodeData) m) => MP.StateRoot -> [(Integer, obj)] -> m MP.StateRoot
addAllKVsMem sr [] = return sr
addAllKVsMem sr (x:rest) = do
  sr' <- MP.putKeyVal sr (byteString2NibbleString $ rlpSerialize $ rlpEncode $ fst x) (rlpEncode $ rlpSerialize $ rlpEncode $ snd x)
  addAllKVsMem sr' rest

transactionsVerificationValue :: [Transaction] -> MP.StateRoot
transactionsVerificationValue theList = runIdentity . MP.runMP . addAllKVsMem MP.emptyTriePtr $ zip [0..] theList

ommersVerificationValue::[BlockData]->Keccak256
ommersVerificationValue = listToRLPVerificationValue

receiptsVerificationValue::()->MP.StateRoot
receiptsVerificationValue _ = MP.emptyTriePtr

listToRLPVerificationValue :: (RLPSerializable a) => [a] -> Keccak256
listToRLPVerificationValue = hash ∘ rlpSerialize ∘ RLPArray ∘ map rlpEncode
