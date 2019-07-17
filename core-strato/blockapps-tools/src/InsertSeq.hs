{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications  #-}
module InsertSeq where

import Data.Aeson
import qualified Data.ByteString.Char8 as C8
import qualified Data.ByteString.Lazy.Char8 as BLC
import System.Exit
import Text.Printf

import Blockchain.Data.Block
import Blockchain.Data.ChainInfo
import Blockchain.Data.DataDefs
import Blockchain.Data.Json
import Blockchain.Data.Transaction
import qualified Blockchain.Data.TXOrigin as TXO
import Blockchain.EthConf
import Blockchain.ExtWord
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Blockchain.TypeLits
import Blockchain.Util (getCurrentMicrotime)

insertSeq :: IngestEvent -> IO ()
insertSeq iev = do
  printf "Inserting %s into unseqevents...\n" $ show iev
  resps <- runKafkaConfigured "queryStrato" $ do
    assertTopicCreation
    writeUnseqEvents [iev]
  mapM_ print resps

addTx :: String -> IO ()
addTx tx' = do
  rtx <- either (die . printf "failed raw tx decoding: %s") (return . rtPrimeToRt) . eitherDecodeStrict . C8.pack $ tx'
  let origin = rawTransactionOrigin rtx
      tx = rawTX2TX rtx
  now <- getCurrentMicrotime
  let iev = IETx now $ IngestTx origin tx
  insertSeq iev

addBlocksFromFile :: FilePath -> IO ()
addBlocksFromFile fileName = do
  file <- BLC.readFile fileName
  case eitherDecode @[Block'] file of
    Left err -> die $ printf "Malformed block file: %s" err
    Right b -> do
      let bs = map bPrimeToB b
      printf "Inserting %d blocks into unseq_events...\n" (length bs)
      resps <- runKafkaConfigured "queryStrato" $ do
        assertTopicCreation
        writeUnseqEvents $
          map (\(Block bd txs us) ->
             IEBlock (IngestBlock (TXO.PeerString "") bd txs us)) bs
      mapM_ print resps

addGenesisFromFile :: FilePath -> IO ()
addGenesisFromFile fileName = do
  file <- BLC.readFile fileName
  case eitherDecode @(NamedMap "id" Word256 "info" ChainInfo) file of
    Left err -> die $ printf "Malformed ChainInfo file: %s" err
    Right bs -> do
      printf "Inserting %d chain infos into unseq_events...\n" (length bs)
      resps <- runKafkaConfigured "queryStrato" $ do
        assertTopicCreation
        writeUnseqEvents $
          map ((IEGenesis . IngestGenesis (TXO.PeerString "")) . toTuple) bs
      mapM_ print resps

addTxsFromFile :: FilePath -> IO ()
addTxsFromFile fileName = do
  file <- BLC.readFile fileName
  case eitherDecode @[Transaction'] file of
    Left err -> die $ printf "Malformed transaction file: %s" err
    Right b -> do
      let bs = map (\(Transaction' t) -> t) b
      printf "Inserting %d transactions into unseq_events...\n" (length bs)
      t <- getCurrentMicrotime
      resps <- runKafkaConfigured "queryStrato" $ do
        assertTopicCreation
        writeUnseqEvents $
          map (IETx t . IngestTx (TXO.PeerString "")) bs
      mapM_ print resps
