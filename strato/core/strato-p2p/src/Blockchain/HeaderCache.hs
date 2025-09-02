{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE UndecidableInstances #-}

module Blockchain.HeaderCache where

import BlockApps.Crossmon (recordMaxBlockNumber)
import BlockApps.Logging
import Blockchain.Context
import Blockchain.Data.Block
import Blockchain.Data.BlockHeader (BlockHeader)
import qualified Blockchain.Data.BlockHeader as BlockHeader
import Blockchain.Data.Transaction
import Blockchain.EthConf
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Keccak256
import Blockchain.Verification
import Control.Monad
import Data.List hiding (insert, lookup)
import Data.Maybe
import qualified Data.Text as T
import Text.Tools
import Prelude hiding (lookup)

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
    alreadyRequestedRemainingHeaders <- getRemainingBHeaders
    putRemainingBHeaders $ alreadyRequestedRemainingHeaders ++ headers

  getBodiesToFetch = do
    alreadyRequestedHeaders <- getBlockHeaders -- check what already requested
    alreadyRequestedRemainingHeaders <- getRemainingBHeaders

    bodyFetchHeaders <-
      case (alreadyRequestedHeaders, alreadyRequestedRemainingHeaders) of
        ([], _) -> do
          -- proceed if we are not already requesting bodies
          let (newNeededHeaders, remainingHeaders) = splitNeededHeaders alreadyRequestedRemainingHeaders
          putBlockHeaders newNeededHeaders
          $logInfoS "handleEvents/BlockHeaders" $ T.pack $ "putRemainingBHeaders called: inserting " ++ showRanges (map BlockHeader.number remainingHeaders)
          putRemainingBHeaders remainingHeaders
          $logInfoS "handleEvents/BlockHeaders" $ T.pack $ "putBlockHeaders called: inserting " ++ showRanges (map BlockHeader.number newNeededHeaders)
          return newNeededHeaders
        (first, rest) -> do
          let (newNeededHeaders, remainingHeaders) = splitNeededHeaders first
              newRemainingHeaders = remainingHeaders ++ rest
          $logInfoS "handleEvents/BlockHeaders" $ T.pack $ "putRemainingBHeaders called: range = " ++ showRanges (map BlockHeader.number newRemainingHeaders)
          putRemainingBHeaders newRemainingHeaders -- save it to handle later
          $logInfoS "handleEvents/BlockHeaders" $
            "Not requesting BlockBodies because cache is currently in use, but will request after next batch of BlockBodies arrives."
          return newNeededHeaders

    return $ map blockHeaderHash bodyFetchHeaders

  recombineBlocksFromCache bodies = do
    headers <- getBlockHeaders
    let verified = and $ zipWith (\h b -> BlockHeader.transactionsRoot h == transactionsVerificationValue (fst b)) headers bodies
    unless verified $ error "headers don't match bodies"
    $logInfoS "handleEvents/BlockBodies" $ T.pack $ "len headers is " ++ show (length headers) ++ ", len bodies is " ++ show (length bodies)
    unless (null headers) $ recordMaxBlockNumber "p2p_block_bodies" . maximum $ map BlockHeader.number headers
    let blocks' = zipWith createBlockFromHeaderAndBody (morphBlockHeader <$> headers) bodies
    $logInfoS "handleEvents/BlockBodies" $ T.pack $ "Recombined blocks range: " ++ showRanges (map (BlockHeader.number . blockBlockData) blocks')

    putBlockHeaders $ drop (length blocks') headers

    return blocks'






splitNeededHeaders :: [BlockHeader] -> ([BlockHeader], [BlockHeader])
splitNeededHeaders neededHeaders =
  let txsLens = BlockHeader.extraData2TxsLen <$> BlockHeader.extraData <$> neededHeaders
      txsLensInSums = scanl (+) (0) $ fromMaybe (averageTxsPerBlock $ p2pConfig ethConf) <$> txsLens
      txsLensInLimit = takeWhile (< (maxHeadersTxsLens $ p2pConfig ethConf)) $ tail txsLensInSums
   in splitAt (length txsLensInLimit) neededHeaders
