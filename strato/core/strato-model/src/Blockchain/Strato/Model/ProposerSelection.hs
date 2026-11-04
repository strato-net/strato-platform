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
    stakeWeights,
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

-- | The stake weights in force for a validator set: the published weights when
-- every member has one, nothing otherwise.
--
-- Weights are published one validator at a time (the staking contract syncs a
-- validator when its stake moves, and anyone can move it by a wei), so a set in
-- which some members have weight and others have none is a set whose weights
-- are not all published yet. Weighing such a set would hand it to whoever was
-- published first: a lone weighted member is the first-round proposer and,
-- with everyone else weighing 0, a one-member quorum. So weights are in force only
-- once every member has some; until then the set is unweighted, as before
-- activation. Every consumer of stake weights (leader selection, vote tallies)
-- goes through this, so they switch together.
stakeWeights :: S.Set Validator -> StakeMap -> Maybe (M.Map Validator Integer)
stakeWeights validators stakes
  | not (S.null validators) && all (> 0) (M.elems weights) = Just weights
  | otherwise = Nothing
  where
    weights = M.fromSet (\v -> max 0 (M.findWithDefault 0 v stakes)) validators

-- | @selectProposer chainId height validators stakes startRound round@ selects
-- the proposer for @height@ at PBFT round @round@, where @startRound@ is the
-- round the height began at (the round of the parent block; rounds persist
-- across heights and only advance on timeouts).
--
-- A round picks a validator with probability proportional to its stake while
-- the set's weights are in force ('stakeWeights'); otherwise the pick is
-- uniform over the sorted candidate list. The proposers chosen for the
-- previous rounds of this height (at most @n - 1@ of them) are excluded, so a
-- round change always moves to a different validator.
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
    inForce = stakeWeights validators stakes

    go r cands =
      let pick = pickWeighted (selectionSeed chainId height r) cands
       in if r >= rnd then pick else go (r + 1) (filter (/= pick) cands)

    pickWeighted seed cands = case inForce of
      Nothing -> cands !! fromInteger (seed `mod` toInteger (length cands))
      Just ws ->
        let weights = [(c, ws M.! c) | c <- cands]
         in walk (seed `mod` sum (map snd weights)) weights

    walk _ [] = error "selectProposer: exhausted weights"
    walk x ((c, w) : rest)
      | x < w = c
      | otherwise = walk (x - w) rest
