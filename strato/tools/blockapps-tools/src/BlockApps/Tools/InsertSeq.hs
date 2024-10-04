{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeApplications #-}

module BlockApps.Tools.InsertSeq where

-- import Control.Monad
import Blockchain.Blockstanbul
import Blockchain.Data.Block
import Blockchain.Data.DataDefs
import Blockchain.Data.Json
import qualified Blockchain.Data.TXOrigin as TXO
import Blockchain.Data.Transaction
import Blockchain.EthConf
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.MicroTime (getCurrentMicrotime)
import Data.Aeson
import qualified Data.ByteString.Char8 as C8
import qualified Data.ByteString.Lazy.Char8 as BLC
--import Network.Kafka.Protocol as KP
import System.Exit
import Text.Printf

insertSeq :: IngestEvent -> IO ()
insertSeq iev = do
  printf "Inserting %s into unseqevents...\n" $ show iev
  resps <- runKafkaMConfigured "queryStrato" $ do
    assertSequencerTopicsCreation
    writeUnseqEvents [iev]
  mapM_ print resps

validatorBehavior :: Bool -> IO ()
validatorBehavior valB = do
  printf "Validator behavior = %s \n" $ show valB
  let msg = IEValidatorBehavior . ForcedValidator $ valB
  print msg
  resp <- runKafkaMConfigured "validator-bevaiour-flag" $ do
    writeUnseqEvents [msg]
  print resp

deleteDepBlock :: String -> IO ()
deleteDepBlock k = do
  printf "deleteDepBlock = %s \n" $ k
  let msg = IEDeleteDepBlock $ keccak256FromHex k
  print msg
  resp <- runKafkaMConfigured "delete-dep-block" $ do
    writeUnseqEvents [msg]
  print resp

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
      resps <- runKafkaMConfigured "queryStrato" $ do
        assertSequencerTopicsCreation
        writeUnseqEvents $
          map
            ( \(Block bd txs us) ->
                IEBlock (IngestBlock (TXO.PeerString "") bd txs us)
            )
            bs
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
      resps <- runKafkaMConfigured "queryStrato" $ do
        assertSequencerTopicsCreation
        writeUnseqEvents $
          map (IETx t . IngestTx (TXO.PeerString "")) bs
      mapM_ print resps
