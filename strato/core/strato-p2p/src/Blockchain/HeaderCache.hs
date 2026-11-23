{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE UndecidableInstances #-}

module Blockchain.HeaderCache where

import BlockApps.Crossmon (recordMaxBlockNumber)
import BlockApps.Logging
import Blockchain.Context
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader (BlockHeader)
import qualified Blockchain.Data.BlockHeader as BlockHeader
import Blockchain.Data.Transaction
import Blockchain.EthConf (ethConf, p2pConfig)
import qualified Blockchain.EthConf.Model as Conf
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Keccak256
import Blockchain.Verification
import Control.Monad
import Blockchain.Model.SyncState (BestSequencedBlock, bestSequencedBlockNumber)
import qualified Control.Monad.Change.Modify as Mod
import Data.List hiding (insert, lookup)
import Data.Maybe
import qualified Data.Set as Set
import qualified Data.Text as T
import Text.Tools
import Prelude hiding (lookup)

-- | The most headers one connection keeps waiting for their bodies: two
-- GetBlockHeaders answers' worth. A peer may send headers it was not asked for
-- (P2pPushBlocks does, to help a lagging node catch up), so without a bound a
-- peer streaming made-up headers above our tip grew the cache until the
-- process ran out of memory. The oldest waiting headers are kept: they are the
-- ones sync needs next.
remainingHeadersCap :: Int
remainingHeadersCap = 2 * Conf.maxReturnedHeaders (p2pConfig ethConf)

class HasHeaderCache m where
  isBodyRequestActive :: m Bool
  addToHeaderCache :: [BlockHeader] -> m ()
  getBodiesToFetch :: m [Keccak256]
  recombineBlocksFromCache :: [([Transaction], [BlockHeader])] -> m [Block]

instance MonadP2P m => HasHeaderCache m where
  isBodyRequestActive = do
    alreadyRequestedHeaders <- getBlockHeaders -- check what already requested
    return $ not $ null alreadyRequestedHeaders

  addToHeaderCache headers = do
    myBest <- bestSequencedBlockNumber <$> Mod.get (Mod.Proxy @BestSequencedBlock)
    alreadyRequestedRemainingHeaders <- getRemainingBHeaders
    inFlight <- getBlockHeaders
    -- Never queue a header that is already committed or already being fetched.
    -- Every peer answers the same tip-follow GetBlockHeaders, so without this
    -- the same 500-header range piles into the cache once per peer; the
    -- duplicated in-flight set then wedges body fetching until the stale-cache
    -- wipe. Stale sub-tip entries similarly accumulated forever.
    let inFlightHashes = Set.fromList $ blockHeaderHash <$> inFlight
        !combined =
          take remainingHeadersCap
            . filter ((`Set.notMember` inFlightHashes) . blockHeaderHash)
            . pruneAndDedupHeaders myBest
            $ alreadyRequestedRemainingHeaders ++ take remainingHeadersCap headers
    length combined `seq` putRemainingBHeaders combined

  getBodiesToFetch = do
    myBest <- bestSequencedBlockNumber <$> Mod.get (Mod.Proxy @BestSequencedBlock)
    alreadyRequestedHeaders <- getBlockHeaders -- check what already requested
    alreadyRequestedRemainingHeaders <- getRemainingBHeaders

    bodyFetchHeaders <-
      case (alreadyRequestedHeaders, alreadyRequestedRemainingHeaders) of
        ([], _) -> do
          -- proceed if we are not already requesting bodies
          -- (prune here too: entries may have committed since they were queued)
          let (newNeededHeaders, remainingHeaders) = splitNeededHeaders $ pruneAndDedupHeaders myBest alreadyRequestedRemainingHeaders
          putBlockHeaders newNeededHeaders
          $logInfoS "handleEvents/BlockHeaders" $ T.pack $ "putRemainingBHeaders called: inserting " ++ showRanges (map BlockHeader.number remainingHeaders)
          putRemainingBHeaders remainingHeaders
          $logInfoS "handleEvents/BlockHeaders" $ T.pack $ "putBlockHeaders called: inserting " ++ showRanges (map BlockHeader.number newNeededHeaders)
          return newNeededHeaders
        (first, rest) -> do
          let (newNeededHeaders, remainingHeaders) = splitNeededHeaders first
              !newRemainingHeaders = remainingHeaders ++ rest
          $logInfoS "handleEvents/BlockHeaders" $ T.pack $ "putRemainingBHeaders called: range = " ++ showRanges (map BlockHeader.number newRemainingHeaders)
          length newRemainingHeaders `seq` putRemainingBHeaders newRemainingHeaders
          $logInfoS "handleEvents/BlockHeaders" $
            "Not requesting BlockBodies because cache is currently in use, but will request after next batch of BlockBodies arrives."
          return newNeededHeaders

    return $ map blockHeaderHash bodyFetchHeaders

  recombineBlocksFromCache bodies = do
    headers <- getBlockHeaders
    let verified = and $ zipWith (\h b -> BlockHeader.transactionsRoot h == transactionsVerificationValue (fst b)) headers bodies
    unless verified $ error "headers don't match bodies"
    $logInfoS "handleEvents/BlockBodies" $ T.pack $ "len headers is " ++ show (length headers) ++ ", len bodies is " ++ show (length bodies)
    unless (null headers) $ recordMaxBlockNumber "p2p_block_bodies" . maximum . (0:) $ map BlockHeader.number headers
    let blocks' = zipWith createBlockFromHeaderAndBody (morphBlockHeader <$> headers) bodies
    $logInfoS "handleEvents/BlockBodies" $ T.pack $ "Recombined blocks range: " ++ showRanges (map (BlockHeader.number . blockBlockData) blocks')

    putBlockHeaders $ drop (length blocks') headers

    return blocks'






-- | Drop headers at or below the sequenced tip and collapse duplicates,
-- preserving order. Both arise because every connected peer answers the same
-- tip-follow header request.
pruneAndDedupHeaders :: Integer -> [BlockHeader] -> [BlockHeader]
pruneAndDedupHeaders myBest = go Set.empty
  where
    go _ [] = []
    go seen (h : hs)
      | BlockHeader.number h <= myBest = go seen hs
      | hsh `Set.member` seen = go seen hs
      | otherwise = h : go (Set.insert hsh seen) hs
      where
        hsh = blockHeaderHash h

splitNeededHeaders :: [BlockHeader] -> ([BlockHeader], [BlockHeader])
splitNeededHeaders neededHeaders =
  let txsLens = BlockHeader.extraData2TxsLen <$> BlockHeader.extraData <$> neededHeaders
      txsLensInSums = scanl (+) (0) $ fromMaybe (Conf.averageTxsPerBlock (p2pConfig ethConf)) <$> txsLens
      txsLensInLimit = case txsLensInSums of
        [] -> []
        (_:xs) -> takeWhile (< Conf.maxHeadersTxsLens (p2pConfig ethConf)) xs
   in splitAt (length txsLensInLimit) neededHeaders
