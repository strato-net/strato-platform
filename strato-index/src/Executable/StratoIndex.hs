{-# LANGUAGE OverloadedStrings, TemplateHaskell #-}

module Executable.StratoIndex (
  stratoIndex
  ) where

import Control.Lens hiding (Context)
import Control.Monad
import Control.Monad.IO.Class
import Control.Monad.Logger
import Data.List
import qualified Data.Text as T
import Network.Kafka
import Network.Kafka.Protocol

import Blockchain.Constants
import Blockchain.Data.BlockDB
import Blockchain.Data.Extra
import Blockchain.SHA
import Blockchain.DB.SQLDB
import Blockchain.IContext
import Blockchain.IOptions
import Blockchain.SemiPermanent
import Blockchain.Stream.VMEvent
import Blockchain.EthConf

import Data.Ord
import Database.Persist.Sql

  
stratoIndex::LoggingT IO ()
stratoIndex = do
  offsetVar <- liftIO $ newSemiPermanent 0 $ dbDir "h" ++ indexOffsetPath

  when (flags_iStartingBlock /= -1) $ liftIO $ setSP offsetVar flags_iStartingBlock

  offset <- liftIO $ getSP offsetVar

  runIContextM $ do
    genesisBlockHash <- getGenesisHash
    loop genesisBlockHash offsetVar offset

  where
    loop genesisBlockHash offsetVar offset = do
      logInfoNS "strato-index" "About to fetch blocks"      
      vmEvents <- liftIO $ getUnprocessedKafkaVMEvents offset
      let blocks = [b | ChainBlock b <- vmEvents]
      let nums = map (blockDataNumber . blockBlockData) blocks
          nextOffset' = offset + fromIntegral (length vmEvents)
          minedBlocks = filter isMined blocks
          insertCount = length minedBlocks
      when (nextOffset' > offset) $ do
        logInfoNS "strato-index" $ T.pack $ if nextOffset' == offset
                                            then "Considering blocks from " ++ show offset ++ " to " ++ show (nextOffset' - 1)
                                            else "Considering single block " ++ show offset
        if insertCount > 0
          then do
            logInfoNS "strato-index" $ T.pack $ "  (" ++ show insertCount ++ " of them are mined; inserting those)"
            results <- putBlocks [(SHA 0, 0)] minedBlocks False
            let bids = map fst results
--            (bestBlockHash, _) <- getBestBlockInfo
--            let hashes = map blockHash blocks
--            maybe (return ()) putBestIndexBlockInfo $ lookup bestBlockHash $ zip hashes bids
            bestBid <- getBestIndexBlockInfo
            num <- fmap (blockDataNumber . blockBlockData) $ sqlQuery $ getJust bestBid            
            let (num', bid) = maximumBy (comparing fst) $ zip nums bids
            when (num' > num || num' == 0) $ putBestIndexBlockInfo bid
          else logInfoNS "strato-index" "  (all unmined, not inserting any)"
      liftIO $ setSP offsetVar nextOffset'
      loop genesisBlockHash offsetVar nextOffset'

isMined::Block->Bool
isMined Block{blockBlockData=BlockData{blockDataNonce=n}} = n /= 5

getUnprocessedKafkaVMEvents::Integer->IO [VMEvent]
getUnprocessedKafkaVMEvents offset = do
  ret <-
      runKafkaConfigured "strato-index" $ do
        stateRequiredAcks .= -1
        stateWaitSize .= 1
        stateWaitTime .= 100000
        fetchVMEvents (Offset $ fromIntegral offset)

  case ret of
    Left e -> error $ show e
    Right v -> return v
