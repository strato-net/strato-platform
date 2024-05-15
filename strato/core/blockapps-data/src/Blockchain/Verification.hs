{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators #-}

module Blockchain.Verification
  ( transactionsVerificationValue,
    ommersVerificationValue,
    receiptsVerificationValue,
  )
where

import Blockchain.Data.BlockHeader
import Blockchain.Data.RLP
import Blockchain.Data.Transaction
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Strato.Model.Keccak256
import Data.Functor.Identity
import Prelude.Unicode

{-
transactionsVerificationValue::[Transaction]->MP.StateRoot
transactionsVerificationValue = MP.sha2StateRoot . listToRLPVerificationValue
-}

transactionsVerificationValue :: [Transaction] -> MP.StateRoot
transactionsVerificationValue theList = runIdentity . MP.runMP . MP.addAllKVs MP.emptyTriePtr $ zip [(0 :: Integer) ..] theList

ommersVerificationValue :: [BlockHeader] -> Keccak256
ommersVerificationValue = listToRLPVerificationValue

receiptsVerificationValue :: () -> MP.StateRoot
receiptsVerificationValue _ = MP.emptyTriePtr

listToRLPVerificationValue :: (RLPSerializable a) => [a] -> Keccak256
listToRLPVerificationValue = hash ∘ rlpSerialize ∘ RLPArray ∘ map rlpEncode
