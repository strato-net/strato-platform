{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE LambdaCase         #-}
{-# LANGUAGE OverloadedStrings  #-}
module Checkpoints where

import           Control.Concurrent              (threadDelay)
import           Control.Monad                   (forM_, unless, void, when)

import qualified Data.ByteString.Char8           as S8
import           Data.Data
import           Data.Maybe

import           GHC.Read
import           System.IO
import qualified Text.ParserCombinators.ReadPrec as P
import qualified Text.Read.Lex                   as L

import           Blockchain.EthConf

import qualified Network.Kafka                   as K
import qualified Blockchain.MilenaTools          as K
import qualified Network.Kafka.Protocol          as KP

import qualified Blockchain.Sequencer.Constants         as SeqConst
import qualified Blockchain.Sequencer.Kafka             as SeqKafka
import qualified Blockchain.Strato.Indexer.Kafka        as IdxKafka
import qualified Blockchain.Strato.StateDiff.Kafka      as DiffKafka

data CheckpointService   = Sequencer | EVM | ApiIndexer | P2PIndexer | Slipstream | NullService deriving (Eq, Ord, Enum, Data)
data CheckpointOperation = Get | Put | NullOperation deriving (Eq, Ord, Enum, Data)

-- have to manually do these cause theres no way to lowercase them for glorious lowercase cli
instance Read CheckpointOperation where
    readPrec = parens $ do
        L.Ident s <- lexP
        case s of
            "get" -> return Get
            "put" -> return Put
            _     -> P.pfail

instance Show CheckpointOperation where
    show Get           = "get"
    show Put           = "put"
    show NullOperation = "NullOperation"

instance Read CheckpointService where
    readPrec = parens $ do
        L.Ident s <- lexP
        case s of
            "sequencer"   -> return Sequencer
            "evm"         -> return EVM
            "apiindexer"  -> return ApiIndexer
            "p2pindexer"  -> return P2PIndexer
            "slipstream"  -> return Slipstream
            "NullService" -> return NullService
            _             -> P.pfail

instance Show CheckpointService where
    show Sequencer   = "sequencer"
    show EVM         = "evm"
    show ApiIndexer  = "apiindexer"
    show P2PIndexer  = "p2pindexer"
    show Slipstream  = "slipstream"
    show NullService = "NullService"

type KafkaBits = (K.KafkaClientId, KP.ConsumerGroup, KP.TopicName)
type CPTuple   = (KP.Offset, KP.Metadata)

kafkaBitsForService :: CheckpointService -> KafkaBits
kafkaBitsForService = \case
    NullService -> error "kafkaBitsForService NullService called"
    Sequencer -> let clientId = KP.KString (S8.pack SeqConst.defaultKafkaClientId') in
        (clientId, lookupConsumerGroup clientId, SeqKafka.unseqEventsTopicName)
    EVM -> let clientId = "ethereum-vm" in
        (clientId, lookupConsumerGroup clientId, SeqKafka.seqVmEventsTopicName)
    ApiIndexer -> let clientId = "strato-api-indexer" in
        (clientId, lookupConsumerGroup clientId, IdxKafka.indexEventsTopicName)
    P2PIndexer -> let clientId = "strato-p2p-indexer" in
            (clientId, lookupConsumerGroup clientId, IdxKafka.indexEventsTopicName)
    Slipstream -> let clientId = "slipstream" in
            (clientId, lookupConsumerGroup clientId, DiffKafka.stateDiffTopicName)

hasCheckpointData :: CheckpointService -> Bool
hasCheckpointData EVM        = True
hasCheckpointData ApiIndexer = True
hasCheckpointData _          = False

makeCheckpointData :: CheckpointService -> KP.Metadata -> String -> KP.Metadata
makeCheckpointData EVM _ arg = KP.Metadata . KP.KString $ S8.pack arg
makeCheckpointData _ oldMD _ = oldMD

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
showCheckpointData :: CheckpointService -> CPTuple -> IO ()
showCheckpointData EVM        = putStrLn . (++ "\n") . ("Metadata is:\n" ++) . S8.unpack . KP._kString . K._kMetadata . snd
showCheckpointData ApiIndexer = putStrLn . (++ "\n") . ("Metadata is:\n" ++) . S8.unpack . KP._kString . K._kMetadata . snd
showCheckpointData svc        = error $ "showCheckpointData called for service `" ++ show svc ++ "` which is unsupported"

getAndDisplayExistingData :: CheckpointService -> IO CPTuple
getAndDisplayExistingData service = do
    kafkaData <- lookupByBits (kafkaBitsForService service)
    showOffset kafkaData
    when (hasCheckpointData service) $ showCheckpointData service kafkaData
    return kafkaData

doCheckpointGet :: CheckpointService -> IO ()
doCheckpointGet service = do
    putStrLn $ "Checkpoint for service: " ++ show service
    void $ getAndDisplayExistingData service

writeCheckpoint :: KafkaBits -> CPTuple -> IO ()
writeCheckpoint (clientId, consumerId, topicName) (ofs, md) = void $
    runKafkaConfigured clientId (K.commitSingleOffset consumerId topicName 0 ofs md) >>=
        either (error . ("Error when committing offset: " ++) . show) return

doCheckpointPut :: CheckpointService -> Maybe KP.Offset -> Maybe String -> IO ()
doCheckpointPut service maybeNewOfs maybeNewData = do
    unless (isJust maybeNewOfs || isJust maybeNewData) $ error errPutFlagRequirement
    when (isJust maybeNewData && not (hasCheckpointData service)) $
        error $ "Service `" ++ show service ++ "` does not take checkpoint metadata"

    putStrLn $ "Existing data for service: " ++ show service
    (oldOfs, oldData) <- getAndDisplayExistingData service

    let newCp   = (newOfs, newData)
        newOfs  = fromMaybe oldOfs maybeNewOfs
        newData = makeCheckpointData service oldData (fromMaybe "" maybeNewData)
    putStrLn ""

    putStrLn $ "Will commit the following checkpoint for service: " ++ show service
    showOffset newCp
    when (hasCheckpointData service) $ showCheckpointData service newCp
    putStrLn ""

    writeCheckpoint (kafkaBitsForService service) newCp

    putStrLn $ "Verify commit for service: " ++ show service
    verifyCP <- getAndDisplayExistingData service
    showOffset verifyCP
    when (hasCheckpointData service) $ showCheckpointData service verifyCP


errPutFlagRequirement :: String
errPutFlagRequirement = "At least one of --offset or --metadata is required when using -o put"

checkpointUsage :: [String]
checkpointUsage =
    [ "queryStrato checkpoints -s,--service SERVICE -o,--operation get|put [-i,--offset Offset] [-m,--metadata CheckpointData]"
    , ""
    , "Notes:"
    , "   * " ++ errPutFlagRequirement
    , ""
    , "Flags:"
    , "  -s --service=SERVICE  The service whose metadata to operate against. One of: sequencer evm apiindexer p2pindexer slipstream"
    , "  -o --op=OP            The operation to perform. One of: get put"
    , "  -i --offset=INT       If -o PUT is specified, set the service's checkpointed Kafka offset"
    , "  -m --metadata=DATA    If -o PUT is specified, set the service-specific metadata in the checkpoint to DATA"
    , ""
    , "Common flags:"
    , "  -? --help             Display a significantly less useful help message"
    , "  -V --version          Print version information"
    ]

doCheckpointUsage :: IO ()
doCheckpointUsage = forM_ checkpointUsage putStrLn
