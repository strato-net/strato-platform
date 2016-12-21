{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Verification (
  transactionsVerificationValue,
  ommersVerificationValue,
  receiptsVerificationValue
  ) where

import Prelude.Unicode


import Blockchain.Data.BlockDB
import Blockchain.Data.RLP
import Blockchain.Data.Transaction
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.SHA
import Blockchain.Database.MerklePatricia.InternalMem
import Blockchain.Database.MerklePatriciaMem
import Blockchain.Util

import Data.Functor.Identity

{-
transactionsVerificationValue::[Transaction]->MP.StateRoot
transactionsVerificationValue = MP.sha2StateRoot . listToRLPVerificationValue
-}


addAllKVsMem::RLPSerializable obj=>Monad m=>MPMem->[(Integer, obj)]->m MPMem
addAllKVsMem x [] = return x
addAllKVsMem mpdb (x:rest) = do
  mpdb' <- unsafePutKeyValMem mpdb (byteString2NibbleString $ rlpSerialize $ rlpEncode $ fst x) (rlpEncode $ rlpSerialize $ rlpEncode $ snd x)
  addAllKVsMem mpdb' rest

blank :: MPMem
blank = initializeBlankMem { mpStateRoot = MP.emptyTriePtr }

transactionsVerificationValue::[Transaction]->MP.StateRoot
transactionsVerificationValue theList = runIdentity $ do
    mp <- addAllKVsMem blank $ zip [0..] $ theList
    return (mpStateRoot mp)

ommersVerificationValue::[BlockData]->SHA
ommersVerificationValue = listToRLPVerificationValue 

receiptsVerificationValue::()->MP.StateRoot
receiptsVerificationValue _ = MP.emptyTriePtr

listToRLPVerificationValue :: (RLPSerializable a) => [a] -> SHA
listToRLPVerificationValue = hash ∘ rlpSerialize ∘ RLPArray ∘ map rlpEncode
