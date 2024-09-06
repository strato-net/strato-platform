{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}

--removing this, as it doesn't apply to RabbitMQ, which will be added soon.  I'm keeping the code here for now, as we might need something similar soon
module BlockApps.Tools.Checkpoints where
{-
  ( doCheckpointPut,
    doCheckpointGet,
    doCheckpointUsage,
    CheckpointService (..),
    CheckpointOperation (..),
  )
where

import Blockchain.EthConf
import qualified Blockchain.MilenaTools as K
import qualified Blockchain.Sequencer.Constants as SeqConst
import qualified Blockchain.Sequencer.Kafka as SeqKafka
import qualified Blockchain.Strato.Indexer.Kafka as IdxKafka
import qualified Blockchain.Strato.StateDiff.Kafka as DiffKafka
import Control.Concurrent (threadDelay)
import Control.Monad (forM_, unless, void)
import qualified Data.ByteString.Char8 as S8
import Data.Data
import Data.Maybe
import Data.String
import GHC.Read
import qualified Network.Kafka as K
import qualified Network.Kafka.Protocol as KP
import System.IO
import qualified Text.ParserCombinators.ReadPrec as P
import qualified Text.Read.Lex as L

data CheckpointService = Sequencer | EVM | ApiIndexer | P2PIndexer | Slipstream | NullService deriving (Eq, Ord, Enum, Data)

data CheckpointOperation = Get | Put | NullOperation deriving (Eq, Ord, Enum, Data)

-- have to manually do these cause theres no way to lowercase them for glorious lowercase cli
instance Read CheckpointOperation where
  readPrec = parens $ do
    L.Ident s <- lexP
    case s of
      "get" -> return Get
      "put" -> return Put
      _ -> P.pfail

instance Show CheckpointOperation where
  show Get = "get"
  show Put = "put"
  show NullOperation = "NullOperation"

instance Read CheckpointService where
  readPrec = parens $ do
    L.Ident s <- lexP
    case s of
      "sequencer" -> return Sequencer
      "evm" -> return EVM
      "apiindexer" -> return ApiIndexer
      "p2pindexer" -> return P2PIndexer
      "slipstream" -> return Slipstream
      "NullService" -> return NullService
      _ -> P.pfail

instance Show CheckpointService where
  show Sequencer = "sequencer"
  show EVM = "evm"
  show ApiIndexer = "apiindexer"
  show P2PIndexer = "p2pindexer"
  show Slipstream = "slipstream"
  show NullService = "NullService"

type KafkaBits = (K.KafkaClientId, KP.ConsumerGroup, KP.TopicName)

type CPTuple = (KP.Offset, KP.Metadata)

kafkaBitsForService :: CheckpointService -> KafkaBits
kafkaBitsForService = \case
  NullService -> error "kafkaBitsForService NullService called"
  Sequencer ->
    (fromString SeqConst.defaultKafkaClientId', fromString SeqConst.defaultKafkaClientId', SeqKafka.unseqEventsTopicName)
  EVM -> ("ethereum-vm", "ethereum-vm", SeqKafka.seqVmEventsTopicName)
  ApiIndexer -> ("strato-api-indexer", "strato-api-indexer", IdxKafka.indexEventsTopicName)
  P2PIndexer -> ("strato-p2p-indexer", "strato-p2p-indexer", IdxKafka.indexEventsTopicName)
  Slipstream -> ("slipstream", "slipstream", DiffKafka.stateDiffTopicName)

lookupByBits :: KafkaBits -> IO CPTuple
lookupByBits bits@(clientId, consumerId, topicName) =
  runKafkaConfigured clientId (K.fetchSingleOffset consumerId topicName 0) >>= \case
    Left err -> error $ "Failed to fetch checkpoint: " ++ show err
    Right (Left KP.UnknownTopicOrPartition) -> do
      hPutStrLn stderr "UnknownTopicOrPartition, retrying..."
      threadDelay 1000000
      lookupByBits bits
    Right (Left err) -> error $ "Unexpected response when fetching checkpoint: " ++ show err
    Right (Right ret) -> return ret

showOffset :: CPTuple -> IO ()
showOffset = putStrLn . ("Offset is " ++) . show . fst

-- todo:
showCheckpointData :: CPTuple -> IO ()
showCheckpointData = putStrLn . (++ "\n") . ("Metadata is:\n" ++) . S8.unpack . KP._kString . K._kMetadata . snd

getAndDisplayExistingData :: CheckpointService -> IO CPTuple
getAndDisplayExistingData service = do
  kafkaData <- lookupByBits (kafkaBitsForService service)
  showOffset kafkaData
  showCheckpointData kafkaData
  return kafkaData

doCheckpointGet :: CheckpointService -> IO ()
doCheckpointGet service = do
  putStrLn $ "Checkpoint for service: " ++ show service
  void $ getAndDisplayExistingData service

writeCheckpoint :: KafkaBits -> CPTuple -> IO ()
writeCheckpoint (clientId, consumerId, topicName) (ofs, md) =
  void $
    runKafkaConfigured clientId (K.commitSingleOffset consumerId topicName 0 ofs md)
      >>= either (error . ("Error when committing offset: " ++) . show) return

doCheckpointPut :: CheckpointService -> Maybe KP.Offset -> Maybe String -> IO ()
doCheckpointPut service maybeNewOfs maybeNewData = do
  unless (isJust maybeNewOfs || isJust maybeNewData) $ error errPutFlagRequirement

  putStrLn $ "Existing data for service: " ++ show service
  (oldOfs, oldData) <- getAndDisplayExistingData service
  let newCp = (newOfs, newData)
      newOfs = fromMaybe oldOfs maybeNewOfs
      newData = maybe oldData (KP.Metadata . KP.KString . S8.pack) maybeNewData

  putStrLn $ "Will commit the following checkpoint for service: " ++ show service
  showOffset newCp
  showCheckpointData newCp
  putStrLn ""

  writeCheckpoint (kafkaBitsForService service) newCp

  putStrLn $ "Verify commit for service: " ++ show service
  verifyCP <- getAndDisplayExistingData service
  showOffset verifyCP
  showCheckpointData verifyCP

errPutFlagRequirement :: String
errPutFlagRequirement = "At least one of --offset or --metadata is required when using -o put"

checkpointUsage :: [String]
checkpointUsage =
  [ "queryStrato checkpoints -s,--service SERVICE -o,--operation get|put [-i,--offset Offset] [-m,--metadata CheckpointData]",
    "",
    "Notes:",
    "   * " ++ errPutFlagRequirement,
    "",
    "Flags:",
    "  -s --service=SERVICE  The service whose metadata to operate against. One of: sequencer evm apiindexer p2pindexer slipstream",
    "  -o --op=OP            The operation to perform. One of: get put",
    "  -i --offset=INT       If -o PUT is specified, set the service's checkpointed Kafka offset",
    "  -m --metadata=DATA    If -o PUT is specified, set the service-specific metadata in the checkpoint to DATA",
    "",
    "Common flags:",
    "  -? --help             Display a significantly less useful help message",
    "  -V --version          Print version information"
  ]

doCheckpointUsage :: IO ()
doCheckpointUsage = forM_ checkpointUsage putStrLn
-}
