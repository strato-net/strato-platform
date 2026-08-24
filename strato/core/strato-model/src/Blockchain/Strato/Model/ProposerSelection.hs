{-# LANGUAGE OverloadedStrings #-}

-- | Deterministic stake-weighted proposer selection.
--
-- Every node (validators, syncing nodes and the VM) must agree on the proposer
-- for a given height and round, so this module is pure and depends only on
-- data that is available in (or derivable from) the block header and that the
-- proposer cannot choose: the chain id, the block number, the PBFT round and
-- the validator set / stake weights in force for the block (the parent's).
-- The parent hash is deliberately not part of the seed: it would let the
-- previous proposer grind the next leader by varying its block body.
module Blockchain.Strato.Model.ProposerSelection
  ( StakeMap,
    selectProposer,
    selectionSeed,
  )
where

import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Validator
import qualified Data.ByteString as B
import qualified Data.Map.Strict as M
import qualified Data.Set as S

type StakeMap = M.Map Validator Integer

-- | keccak256(chainId ‖ height ‖ round), as an unbounded non-negative Integer.
selectionSeed :: Integer -> Integer -> Integer -> Integer
selectionSeed chainId height rnd =
  toInteger . keccak256ToWord256 . hash $ be256 chainId <> be256 height <> be256 rnd
  where
    be256 :: Integer -> B.ByteString
    be256 = word256ToBytes . fromInteger

-- | @selectProposer chainId height validators stakes startRound round@ selects
-- the proposer for @height@ at PBFT round @round@, where @startRound@ is the
-- round the height began at (the round of the parent block; rounds persist
-- across heights and only advance on timeouts).
--
-- A round picks a validator with probability proportional to its stake
-- (validators without an entry in the stake map weigh 0); if the total weight
-- of the candidates is 0 the pick is uniform over the sorted candidate list.
-- The proposers chosen for the previous rounds of this height (at most
-- @n - 1@ of them) are excluded, so a round change always moves to a different
-- validator.
--
-- The validator set must be non-empty.
selectProposer :: Integer -> Integer -> S.Set Validator -> StakeMap -> Integer -> Integer -> Validator
selectProposer chainId height validators stakes startRound rnd
  | S.null validators = error "selectProposer: empty validator set"
  | otherwise = go firstRound (S.toAscList validators)
  where
    n = toInteger (S.size validators)
    -- only the last n-1 rounds of this height can exclude anybody
    firstRound = max startRound (rnd - (n - 1))

    go r cands =
      let pick = pickWeighted (selectionSeed chainId height r) cands
       in if r >= rnd then pick else go (r + 1) (filter (/= pick) cands)

    pickWeighted seed cands =
      let weights = [(c, max 0 (M.findWithDefault 0 c stakes)) | c <- cands]
          total = sum (map snd weights)
       in if total == 0
            then cands !! fromInteger (seed `mod` toInteger (length cands))
            else walk (seed `mod` total) weights

    walk _ [] = error "selectProposer: exhausted weights"
    walk x ((c, w) : rest)
      | x < w = c
      | otherwise = walk (x - w) rest
