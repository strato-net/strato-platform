{-# LANGUAGE DeriveGeneric #-}

-- | Who proposed a block, who was meant to, and in which round — derived
-- purely from the block header so every node agrees on the values. Blocks
-- expose their parent's facts to contracts as @block.prevProposer@,
-- @block.prevIntendedProposer@ and @block.prevRound@ (see
-- "Blockchain.Data.BlockSummary" and the SolidVM builtins).
module Blockchain.Data.ProposalFacts
  ( ProposalFacts (..),
    noProposalFacts,
    proposalFactsFromHeader,
  )
where

import Blockchain.Blockstanbul.Model.Authentication (getProposerSeal, verifyProposerSeal)
import Blockchain.Data.BlockHeader
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Class (blockHeaderVersion)
import Blockchain.Strato.Model.ProposerSelection
import Blockchain.Strato.Model.Validator (Validator (..))
import Control.DeepSeq
import qualified Data.Map.Strict as M
import Data.Maybe (fromMaybe)
import qualified Data.Set as S
import GHC.Generics

data ProposalFacts = ProposalFacts
  { pfProposer :: Address,
    pfIntendedProposer :: Address,
    pfRound :: Integer
  }
  deriving (Eq, Show, Generic)

instance NFData ProposalFacts

-- | Used for blocks that predate stake-weighted selection (and as a fallback
-- when the parent is unknown): contracts must treat a zero intended proposer
-- as "no information".
noProposalFacts :: ProposalFacts
noProposalFacts = ProposalFacts (Address 0) (Address 0) 0

-- | @proposalFactsFromHeader chainId parentRound header@. Version-3 headers
-- only; older headers yield 'noProposalFacts' by definition so that every node
-- derives the same values regardless of when it upgraded. The intended
-- proposer is the one selected for the round the height started at, i.e. the
-- parent's round (rounds persist across heights and only advance on timeouts),
-- so it differs from the actual proposer exactly when a round change happened
-- at this height.
proposalFactsFromHeader :: Integer -> Integer -> BlockHeader -> ProposalFacts
proposalFactsFromHeader chainId parentRound h
  | blockHeaderVersion h /= 3 = noProposalFacts
  | otherwise =
      ProposalFacts
        { pfProposer = fromMaybe (Address 0) (verifyProposerSeal h =<< getProposerSeal h),
          pfIntendedProposer =
            let Validator intended =
                  selectProposer chainId (number h) (S.fromList $ getBlockValidators h) (M.fromList $ getBlockStakes h) parentRound parentRound
             in intended,
          pfRound = getBlockRound h
        }
