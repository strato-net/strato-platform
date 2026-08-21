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
import Blockchain.Data.Receipt
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

-- | Build the receipts trie root from the per-transaction receipts in a
-- block. Mirrors 'transactionsVerificationValue': the trie is keyed by
-- @rlp(txIndex)@ (0-based) with values @rlp(Receipt)@.
--
-- An empty receipts list returns the empty-trie root, matching the previous
-- placeholder behavior.
receiptsVerificationValue :: [Receipt] -> MP.StateRoot
receiptsVerificationValue theList = runIdentity . MP.runMP . MP.addAllKVs MP.emptyTriePtr $ zip [(0 :: Integer) ..] theList

listToRLPVerificationValue :: (RLPSerializable a) => [a] -> Keccak256
listToRLPVerificationValue = hash ∘ rlpSerialize ∘ RLPArray ∘ map rlpEncode
