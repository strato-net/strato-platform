{-# LANGUAGE NoDeriveAnyClass #-}

module Network.Kafka.Protocol
  ( module Network.Kafka.Protocol
  ) where

import Prelude hiding ((.), id)

-- base
import Control.Applicative
import Control.Category (Category(..))
import Control.Exception (Exception)
import Control.Monad (replicateM, liftM2, liftM3, liftM4, liftM5, unless)
import Data.Bits ((.&.))
import Data.Int
import GHC.Exts (IsString(..))
import GHC.Generics (Generic)
import System.IO

-- Hackage
import Control.Lens
import Control.Monad.IO.Class (MonadIO, liftIO)
import Data.ByteString.Char8 (ByteString)
import Data.ByteString.Lens (unpackedChars)
import Data.Digest.CRC32
import Data.Serialize.Get
import Data.Serialize.Put
import Numeric.Lens
import qualified Data.ByteString.Char8 as B
import qualified Data.ByteString.Lazy.Char8 as LB (fromStrict, toStrict)
import qualified Codec.Compression.GZip as GZip (compress, decompress)
import qualified Network

data ReqResp a where
  MetadataRR :: MonadIO m => MetadataRequest -> ReqResp (m MetadataResponse)
  ProduceRR  :: MonadIO m => ProduceRequest  -> ReqResp (m ProduceResponse)
  FetchRR    :: MonadIO m => FetchRequest    -> ReqResp (m FetchResponse)
  OffsetRR   :: MonadIO m => OffsetRequest   -> ReqResp (m OffsetResponse)
  HeartbeatRR :: MonadIO m => HeartbeatRequest -> ReqResp (m HeartbeatResponse)
  TopicsRR   :: MonadIO m => CreateTopicsRequest -> ReqResp (m CreateTopicsResponse)
  DeleteTopicsRR :: MonadIO m => DeleteTopicsRequest -> ReqResp (m DeleteTopicsResponse)
  OffsetCommitRR :: MonadIO m => OffsetCommitRequest -> ReqResp (m OffsetCommitResponse)
  OffsetFetchRR :: MonadIO m => OffsetFetchRequest -> ReqResp (m OffsetFetchResponse)
  GroupCoordinatorRR  :: MonadIO m => GroupCoordinatorRequest -> ReqResp (m GroupCoordinatorResponse)

doRequest' :: (Deserializable a, MonadIO m) => CorrelationId -> Handle -> Request -> m (Either String a)
doRequest' correlationId h r = do
  rawLength <- liftIO $ do
    B.hPut h $ requestBytes r
    hFlush h
    B.hGet h 4
  case runGet (fmap fromIntegral getWord32be) rawLength of
    Left s -> return $ Left s
    Right dataLength -> do
      responseBytes <- liftIO $ B.hGet h dataLength
      return $ flip runGet responseBytes $ do
        correlationId' <- deserialize
        unless (correlationId == correlationId') $ fail ("Expected " ++ show correlationId ++ " but got " ++ show correlationId')
        isolate (dataLength - 4) deserialize

doRequest :: MonadIO m => ClientId -> CorrelationId -> Handle -> ReqResp (m a) -> m (Either String a)
doRequest clientId correlationId h (MetadataRR req) = doRequest' correlationId h $ Request (correlationId, clientId, MetadataRequest req)
doRequest clientId correlationId h (ProduceRR req)  = doRequest' correlationId h $ Request (correlationId, clientId, ProduceRequest req)
doRequest clientId correlationId h (FetchRR req)    = doRequest' correlationId h $ Request (correlationId, clientId, FetchRequest req)
doRequest clientId correlationId h (OffsetRR req)   = doRequest' correlationId h $ Request (correlationId, clientId, OffsetRequest req)
doRequest clientId correlationId h (HeartbeatRR req)= doRequest' correlationId h $ Request (correlationId, clientId, HeartbeatRequest req)
doRequest clientId correlationId h (TopicsRR req)   = doRequest' correlationId h $ Request (correlationId, clientId, CreateTopicsRequest req)
doRequest clientId correlationId h (DeleteTopicsRR req)   = doRequest' correlationId h $ Request (correlationId, clientId, DeleteTopicsRequest req)
doRequest clientId correlationId h (OffsetCommitRR req) = doRequest' correlationId h $ Request (correlationId, clientId, OffsetCommitRequest req)
doRequest clientId correlationId h (OffsetFetchRR req) = doRequest' correlationId h $ Request (correlationId, clientId, OffsetFetchRequest req)
doRequest clientId correlationId h (GroupCoordinatorRR req)  = doRequest' correlationId h $ Request (correlationId, clientId, GroupCoordinatorRequest req)

class Serializable a where
  serialize :: a -> Put

class Deserializable a where
  deserialize :: Get a

newtype GroupCoordinatorResponse = GroupCoordinatorResp (KafkaError, Broker) deriving (Show, Generic, Eq, Deserializable)

newtype ApiKey = ApiKey Int16 deriving (Show, Eq, Deserializable, Serializable, Num, Integral, Ord, Real, Generic, Enum) -- numeric ID for API (i.e. metadata req, produce req, etc.)
newtype ApiVersion = ApiVersion Int16 deriving (Show, Eq, Deserializable, Serializable, Num, Integral, Ord, Real, Generic, Enum)
newtype CorrelationId = CorrelationId Int32 deriving (Show, Eq, Deserializable, Serializable, Num, Integral, Ord, Real, Generic, Enum)
newtype ClientId = ClientId KafkaString deriving (Show, Eq, Deserializable, Serializable, Generic, IsString)

data RequestMessage = MetadataRequest MetadataRequest
                    | ProduceRequest ProduceRequest
                    | FetchRequest FetchRequest
                    | OffsetRequest OffsetRequest
                    | OffsetCommitRequest OffsetCommitRequest
                    | OffsetFetchRequest OffsetFetchRequest
                    | HeartbeatRequest HeartbeatRequest
                    | GroupCoordinatorRequest GroupCoordinatorRequest
                    | CreateTopicsRequest CreateTopicsRequest
                    | DeleteTopicsRequest DeleteTopicsRequest
                    deriving (Show, Generic, Eq)

newtype MetadataRequest = MetadataReq [TopicName] deriving (Show, Eq, Serializable, Generic, Deserializable)
newtype TopicName = TName { _tName :: KafkaString } deriving (Eq, Ord, Deserializable, Serializable, Generic, IsString)

instance Show TopicName where
  show = show . B.unpack . _kString. _tName

newtype KafkaBytes = KBytes { _kafkaByteString :: ByteString } deriving (Show, Eq, Generic, IsString)
newtype KafkaString = KString { _kString :: ByteString } deriving (Show, Eq, Ord, Generic, IsString)

newtype ProduceResponse =
  ProduceResp { _produceResponseFields :: [(TopicName, [(Partition, KafkaError, Offset)])] }
  deriving (Show, Eq, Deserializable, Serializable, Generic)

newtype OffsetResponse =
  OffsetResp { _offsetResponseFields :: [(TopicName, [PartitionOffsets])] }
  deriving (Show, Eq, Deserializable, Generic)

newtype PartitionOffsets =
  PartitionOffsets { _partitionOffsetsFields :: (Partition, KafkaError, [Offset]) }
  deriving (Show, Eq, Deserializable, Generic)

newtype FetchResponse =
  FetchResp { _fetchResponseFields :: [(TopicName, [(Partition, KafkaError, Offset, MessageSet)])] }
  deriving (Show, Eq, Serializable, Deserializable, Generic)

newtype CreateTopicsResponse =
  TopicsResp { _topicsResponseFields :: [(TopicName, KafkaError)] }
  deriving (Show, Eq, Deserializable, Serializable, Generic)

newtype DeleteTopicsResponse =
  DeleteTopicsResp { _deleteTopicsResponseFields :: [(TopicName, KafkaError)] }
  deriving (Show, Eq, Deserializable, Serializable, Generic)

newtype HeartbeatResponse =
  HeartbeatResp { _heartbeatResponseFields :: KafkaError }
  deriving (Show, Eq, Deserializable, Serializable, Generic)


newtype MetadataResponse = MetadataResp { _metadataResponseFields :: ([Broker], [TopicMetadata]) } deriving (Show, Eq, Deserializable, Generic)
newtype Broker = Broker { _brokerFields :: (NodeId, Host, Port) } deriving (Show, Eq, Ord, Deserializable, Generic)
newtype NodeId = NodeId { _nodeId :: Int32 } deriving (Show, Eq, Deserializable, Num, Integral, Ord, Real, Enum, Generic)
newtype Host = Host { _hostKString :: KafkaString } deriving (Show, Eq, Ord, Deserializable, IsString, Generic)
newtype Port = Port { _portInt :: Int32 } deriving (Show, Eq, Deserializable, Num, Integral, Ord, Real, Enum, Generic)
newtype TopicMetadata = TopicMetadata { _topicMetadataFields :: (KafkaError, TopicName, [PartitionMetadata]) } deriving (Show, Eq, Deserializable, Generic)
newtype PartitionMetadata = PartitionMetadata { _partitionMetadataFields :: (KafkaError, Partition, Leader, Replicas, Isr) } deriving (Show, Eq, Deserializable, Generic)
newtype Leader = Leader { _leaderId :: Maybe Int32 } deriving (Show, Eq, Ord, Generic)

newtype Replicas = Replicas [Int32] deriving (Show, Eq, Serializable, Deserializable, Generic)
newtype Isr = Isr [Int32] deriving (Show, Eq, Deserializable, Generic)

newtype OffsetCommitResponse = OffsetCommitResp [(TopicName, [(Partition, KafkaError)])] deriving (Show, Eq, Deserializable, Generic)
newtype OffsetFetchResponse = OffsetFetchResp [(TopicName, [(Partition, Offset, Metadata, KafkaError)])] deriving (Show, Eq, Deserializable, Generic)

newtype OffsetRequest = OffsetReq (ReplicaId, [(TopicName, [(Partition, Time, MaxNumberOfOffsets)])]) deriving (Show, Eq, Serializable, Generic)
newtype Time = Time { _timeInt :: Int64 } deriving (Show, Eq, Serializable, Num, Integral, Ord, Real, Enum, Bounded, Generic)
newtype MaxNumberOfOffsets = MaxNumberOfOffsets Int32 deriving (Show, Eq, Serializable, Num, Integral, Ord, Real, Enum, Generic)

newtype FetchRequest =
  FetchReq (ReplicaId, MaxWaitTime, MinBytes,
            [(TopicName, [(Partition, Offset, MaxBytes)])])
  deriving (Show, Eq, Deserializable, Serializable, Generic)

newtype ReplicaId = ReplicaId Int32 deriving (Show, Eq, Num, Integral, Ord, Real, Enum, Serializable, Deserializable, Generic)
newtype MaxWaitTime = MaxWaitTime Int32 deriving (Show, Eq, Num, Integral, Ord, Real, Enum, Serializable, Deserializable, Generic)
newtype MinBytes = MinBytes Int32 deriving (Show, Eq, Num, Integral, Ord, Real, Enum, Serializable, Deserializable, Generic)
newtype MaxBytes = MaxBytes Int32 deriving (Show, Eq, Num, Integral, Ord, Real, Enum, Serializable, Deserializable, Generic)

newtype ProduceRequest =
  ProduceReq (RequiredAcks, Timeout,
              [(TopicName, [(Partition, MessageSet)])])
  deriving (Show, Eq, Serializable, Generic)

newtype RequiredAcks =
  RequiredAcks Int16 deriving (Show, Eq, Serializable, Deserializable, Num, Integral, Ord, Real, Enum, Generic)
newtype Timeout =
  Timeout Int32 deriving (Show, Eq, Serializable, Deserializable, Num, Integral, Ord, Real, Enum, Generic)
newtype Partition =
  Partition Int32 deriving (Show, Eq, Serializable, Deserializable, Num, Integral, Ord, Real, Enum, Generic)

data MessageSet = MessageSet { _codec :: CompressionCodec, _messageSetMembers :: [MessageSetMember] }
  deriving (Show, Eq, Generic)
data MessageSetMember =
  MessageSetMember { _setOffset :: Offset, _setMessage :: Message } deriving (Show, Eq, Generic)

newtype Offset = Offset Int64 deriving (Show, Eq, Serializable, Deserializable, Num, Integral, Ord, Real, Enum, Generic)

newtype Message =
  Message { _messageFields :: (Crc, MagicByte, Attributes, Key, Value) }
  deriving (Show, Eq, Deserializable, Generic)

data CompressionCodec = NoCompression | Gzip deriving (Show, Eq, Generic)

newtype Crc = Crc Int32 deriving (Show, Eq, Serializable, Deserializable, Num, Integral, Ord, Real, Enum, Generic)
newtype MagicByte = MagicByte Int8 deriving (Show, Eq, Serializable, Deserializable, Num, Integral, Ord, Real, Enum, Generic)
data Attributes = Attributes { _compressionCodec :: CompressionCodec } deriving (Show, Eq, Generic)

newtype Key = Key { _keyBytes :: Maybe KafkaBytes } deriving (Show, Eq, Generic)
newtype Value = Value { _valueBytes :: Maybe KafkaBytes } deriving (Show, Eq, Generic)

data ResponseMessage = MetadataResponse MetadataResponse
                     | ProduceResponse ProduceResponse
                     | FetchResponse FetchResponse
                     | OffsetResponse OffsetResponse
                     | OffsetCommitResponse OffsetCommitResponse
                     | OffsetFetchResponse OffsetFetchResponse
                     | HeartbeatResponse HeartbeatResponse
                     | GroupCoordinatorResponse GroupCoordinatorResponse
                     | CreateTopicsResponse CreateTopicsResponse
                     | DeleteTopicsResponse DeleteTopicsResponse
                     deriving (Show, Eq, Generic)


newtype GroupId = GroupId { _groupId :: KafkaString } deriving (Show, Eq, Serializable, Generic, IsString)

newtype GenerationId = GenerationId { _genrationId :: Int32 } deriving (Show, Eq, Enum, Num, Ord, Real, Integral, Generic, Serializable)

newtype MemberId = MemberId { _membderId :: KafkaString } deriving (Show, Eq, Generic, Serializable, IsString)


newtype HeartbeatRequest = HeartbeatReq (GroupId, GenerationId, MemberId) deriving (Show, Eq, Serializable, Generic)

newtype ReplicationFactor = ReplicationFactor Int16 deriving (Show, Eq, Num, Integral, Ord, Real, Enum, Serializable, Deserializable, Generic)

newtype GroupCoordinatorRequest = GroupCoordinatorReq ConsumerGroup deriving (Show, Eq, Serializable, Generic)
newtype CreateTopicsRequest = CreateTopicsReq ([(TopicName, Partition, ReplicationFactor, [(Partition, Replicas)], [(KafkaString, Metadata)])], Timeout) deriving (Show, Eq, Serializable, Generic)
newtype DeleteTopicsRequest = DeleteTopicsReq ([TopicName], Timeout) deriving (Show, Eq, Serializable, Generic)

newtype OffsetCommitRequest = OffsetCommitReq (ConsumerGroup, ConsumerGroupGeneration, ConsumerId, Time, [(TopicName, [(Partition, Offset, Metadata)])]) deriving (Show, Eq, Serializable, Generic)
newtype ConsumerGroupGeneration = ConsumerGroupGeneration Int32 deriving (Show, Eq, Deserializable, Serializable, Num, Integral, Ord, Real, Enum)

newtype ConsumerId = ConsumerId KafkaString deriving (Show, Eq, Serializable, Deserializable, IsString)

newtype OffsetFetchRequest = OffsetFetchReq (ConsumerGroup, [(TopicName, [Partition])]) deriving (Show, Eq, Serializable, Generic)
newtype ConsumerGroup = ConsumerGroup KafkaString deriving (Show, Eq, Serializable, Deserializable, IsString, Generic)
newtype Metadata = Metadata KafkaString deriving (Show, Eq, Serializable, Deserializable, IsString, Generic)

errorKafka :: KafkaError -> Int16
errorKafka NoError                             = 0
errorKafka Unknown                             = -1
errorKafka OffsetOutOfRange                    = 1
errorKafka InvalidMessage                      = 2
errorKafka UnknownTopicOrPartition             = 3
errorKafka InvalidMessageSize                  = 4
errorKafka LeaderNotAvailable                  = 5
errorKafka NotLeaderForPartition               = 6
errorKafka RequestTimedOut                     = 7
errorKafka BrokerNotAvailable                  = 8
errorKafka ReplicaNotAvailable                 = 9
errorKafka MessageSizeTooLarge                 = 10
errorKafka StaleControllerEpochCode            = 11
errorKafka OffsetMetadataTooLargeCode          = 12
errorKafka NetworkException                    = 13
errorKafka OffsetsLoadInProgressCode           = 14
errorKafka ConsumerCoordinatorNotAvailableCode = 15
errorKafka NotCoordinatorForConsumerCode       = 16
errorKafka InvalidTopicException               = 17
errorKafka RecordListTooLarge                  = 18
errorKafka NotEnoughReplicas                   = 19
errorKafka NotEnoughReplicasAfterAppend        = 20
errorKafka InvalidRequiredAcks                 = 21
errorKafka IllegalGeneration                   = 22
errorKafka InconsistentGroupProtocol           = 23
errorKafka InvalidGroupId                      = 24
errorKafka UnknownMemberId                     = 25
errorKafka InvalidSessionTimeout               = 26
errorKafka RebalanceInProgress                 = 27
errorKafka InvalidCommitOffsetSize             = 28
errorKafka TopicAuthorizationFailed            = 29
errorKafka GroupAuthorizationFailed            = 30
errorKafka ClusterAuthorizationFailed          = 31
errorKafka InvalidTimestamp                    = 32
errorKafka UnsupportedSASLMechanism            = 33
errorKafka IllegalSASLState                    = 34
errorKafka UnsupportedVersion                  = 35
errorKafka TopicAlreadyExists                  = 36
errorKafka InvalidPartitions                   = 37
errorKafka InvalidReplicationFactor            = 38
errorKafka InvalidReplicaAssignment            = 39
errorKafka InvalidConfig                       = 40
errorKafka NotController                       = 41
errorKafka InvalidRequest                      = 42
errorKafka UnsupportedForMessageFormat         = 43
errorKafka PolicyViolation                     = 44
errorKafka OutOfOrderSequenceNumber            = 45
errorKafka DuplicateSequenceNumber             = 46
errorKafka InvalidProducerEpoch                = 47
errorKafka InvalidTxnState                     = 48
errorKafka InvalidProducerIdMapping            = 49
errorKafka InvalidTransactionTimeout           = 50
errorKafka ConcurrentTransactions              = 51
errorKafka TransactionCoordinatorFenced        = 52
errorKafka TransactionalIdAuthorizationFailed  = 53
errorKafka SecurityDisabled                    = 54
errorKafka OperationNotAttempted               = 55
errorKafka KafkaStorageError                   = 56
errorKafka LogDirNotFound                      = 57
errorKafka SASLAuthenticationFailed            = 58
errorKafka UnknownProducerId                   = 59
errorKafka ReassignmentInProgress              = 60
errorKafka DelegationTokenAuthDisabled         = 61
errorKafka DelegationTokenNotFound             = 62
errorKafka DelegationTokenOwnerMismatch        = 63
errorKafka DelegationTokenRequestNotAllowed    = 64
errorKafka DelegationTokenAuthorizationFailed  = 65
errorKafka DelegationTokenExpired              = 66
errorKafka InvalidPrincipalType                = 67
errorKafka NonEmptyGroup                       = 68
errorKafka GroupIdNotFound                     = 69
errorKafka FetchSessionIdNotFound              = 70
errorKafka InvalidFetchSessionEpoch            = 71
errorKafka ListenerNotFound                    = 72
errorKafka TopicDeletionDisabled               = 73
errorKafka FencedLeaderEpoch                   = 74
errorKafka UnknownLeaderEpoch                  = 75
errorKafka UnsupportedCompressionType          = 76
errorKafka StaleBrokerEpoch                    = 77
errorKafka OffsetNotAvailable                  = 78
errorKafka MemberIdRequired                    = 79
errorKafka PreferredLeaderNotAvailable         = 80
errorKafka GroupMaxSizeReached                 = 81
errorKafka FencedInstanceId                    = 82


data KafkaError = NoError -- ^ @0@ No error--it worked!
                | Unknown -- ^ @-1@ The server experienced an unexpected error when processing the request. (Retriable: false).
                | OffsetOutOfRange -- ^ @1@ The requested offset is not within the range of offsets maintained by the server. (Retriable: false)
                | InvalidMessage -- ^ @2@ This message has failed its CRC checksum, exceeds the valid size, has a null key for a compacted topic, or is otherwise corrupt. (Retriable: true)
                | UnknownTopicOrPartition -- ^ @3@ This server does not host this topic-partition. (Retriable: true)
                | InvalidMessageSize -- ^ @4@ The requested fetch size is invalid. (Retriable: false)
                | LeaderNotAvailable -- ^ @5@ There is no leader for this topic-partition as we are in the middle of a leadership election. (Retriable: true)
                | NotLeaderForPartition -- ^ @6@ This server is not the leader for that topic-partition. (Retriable: true)
                | RequestTimedOut -- ^ @7@ The request timed out. (Retriable: true)
                | BrokerNotAvailable -- ^ @8@ The broker is not available. (Retriable: false)
                | ReplicaNotAvailable -- ^ @9@ The replica is not available for the requested topic-partition. (Retriable: false)
                | MessageSizeTooLarge -- ^ @10@ The request included a message larger than the max message size the server will accept. (Retriable: false)
                | StaleControllerEpochCode -- ^ @11@ The controller moved to another broker. (Retriable: false)
                | OffsetMetadataTooLargeCode -- ^ @12@ The metadata field of the offset request was too large. (Retriable: false)
                | NetworkException -- ^ @13@ The server disconnected before a response was received. (Retriable: true)
                | OffsetsLoadInProgressCode -- ^ @14@ The coordinator is loading and hence can't process requests. (Retriable: true)
                | ConsumerCoordinatorNotAvailableCode -- ^ @15@ The broker returns this error code for consumer metadata requests or offset commit requests if the offsets topic has not yet been created. (Retriable: true)
                | NotCoordinatorForConsumerCode -- ^ @16@ The broker returns this error code if it receives an offset fetch or commit request for a consumer group that it is not a coordinator for. (Retriable: true)
                | InvalidTopicException -- ^ @17@ The request attempted to perform an operation on an invalid topic. (Retriable: false)
                | RecordListTooLarge -- ^ @18@ The request included message batch larger than the configured segment size on the server. (Retriable: false)
                | NotEnoughReplicas -- ^ @19@ Messages are rejected since there are fewer in-sync replicas than required. (Retriable: true)
                | NotEnoughReplicasAfterAppend -- ^ @20@ Messages are written to the log, but to fewer in-sync replicas than required. (Retriable: true)
                | InvalidRequiredAcks -- ^ @21@ Produce request specified an invalid value for required acks. (Retriable: false)
                | IllegalGeneration -- ^ @22@ Specified group generation id is not valid. (Retriable: false)
                | InconsistentGroupProtocol -- ^ @23@ The group member's supported protocols are incompatible with those of existing members or first group member tried to join with empty protocol type or empty protocol list. (Retriable: false)
                | InvalidGroupId -- ^ @24@ -- The configured groupId is invalid. (Retriable: false)
                | UnknownMemberId -- ^ @25@ The coordinator is not aware of this member. (Retriable: false)
                | InvalidSessionTimeout -- ^ @26@ The session timeout is not within the range allowed by the broker (as configured by group.min.session.timeout.ms and group.max.session.timeout.ms). (Retriable: false)
                | RebalanceInProgress -- ^ @27@ The group is rebalancing, so a rejoin is needed. (Retriable: false)
                | InvalidCommitOffsetSize -- ^ @28@ The committing offset data size is not valid. (Retriable: false)
                | TopicAuthorizationFailed -- ^ @29@ Topic authorization failed. (Retriable: false)
                | GroupAuthorizationFailed -- ^ @30@ Group authorization failed. (Retriable: false)
                | ClusterAuthorizationFailed -- ^ @31@ Cluster authorization failed. (Retriable: false)
                | InvalidTimestamp -- ^ @32@ The timestamp of the message is out of acceptable range. (Retriable: false)
                | UnsupportedSASLMechanism -- ^ @33@ The broker does not support the requested SASL mechanism. (Retriable: false)
                | IllegalSASLState -- ^ @34@ Request is not valid given the current SASL state. (Retriable: false)
                | UnsupportedVersion -- ^ @35@ The version of API is not supported. (Retriable: false)
                | TopicAlreadyExists -- ^ @36@ Topic with this name already exists. (Retriable: false)
                | InvalidPartitions -- ^ @37@ Number of partitions is below 1. (Retriable: false)
                | InvalidReplicationFactor -- ^ @38@ Replication factor is below 1 or larger than the number of available brokers. (Retriable: false)
                | InvalidReplicaAssignment -- ^ @39@ Replica assignment is invalid. (Retriable: false)
                | InvalidConfig -- ^ @40@ Configuration is invalid. (Retriable: false)
                | NotController -- ^ @41@ This is not the correct controller for this cluster. (Retriable: true)
                | InvalidRequest -- ^ @42@ This most likely occurs because of a request being malformed by the client library or the message was sent to an incompatible broker. See the broker logs for more details. (Retriable: false)
                | UnsupportedForMessageFormat -- ^ @43@ The message format version on the broker does not support the request. (Retriable: false)
                | PolicyViolation -- ^ @44@ Request parameters do not satisfy the configured policy. (Retriable: false)
                | OutOfOrderSequenceNumber -- ^ @45@ The broker received an out of order sequence number. (Retriable: false)
                | DuplicateSequenceNumber -- ^ @46@ The broker received a duplicate sequence number. (Retriable: false)
                | InvalidProducerEpoch -- ^ @47@ Producer attempted an operation with an old epoch. Either there is a newer producer with the same transactionalId, or the producer's transaction has been expired by the broker. (Retriable: false)
                | InvalidTxnState -- ^ @48@ The producer attempted a transactional operation in an invalid state. (Retriable: false)
                | InvalidProducerIdMapping -- ^ @49@ The producer attempted to use a producer id which is not currently assigned to its transactional id. (Retriable: false)
                | InvalidTransactionTimeout -- ^ @50@ The transaction timeout is larger than the maximum value allowed by the broker (as configured by transaction.max.timeout.ms). (Retriable: false)
                | ConcurrentTransactions -- ^ @51@ The producer attempted to update a transaction while another concurrent operation on the same transaction was ongoing. (Retriable: false)
                | TransactionCoordinatorFenced -- ^ @52@ Indicates that the transaction coordinator sending a WriteTxnMarker is no longer the current coordinator for a given producer. (Retriable: false)
                | TransactionalIdAuthorizationFailed -- ^ @53@ Transactional Id authorization failed. (Retriable: false)
                | SecurityDisabled -- ^ @54@ Security features are disabled. (Retriable: false)
                | OperationNotAttempted -- ^ @55@ The broker did not attempt to execute this operation. This may happen for batched RPCs where some operations in the batch failed, causing the broker to respond without trying the rest. (Retriable: false)
                | KafkaStorageError -- ^ @56@ Disk error when trying to access log file on the disk. (Retriable: true)
                | LogDirNotFound -- ^ @57@ The user-specified log directory is not found in the broker config. (Retriable: false)
                | SASLAuthenticationFailed -- ^ @58@ SASL Authentication failed. (Retriable: false)
                | UnknownProducerId -- ^ @59@ This exception is raised by the broker if it could not locate the producer metadata associated with the producerId in question. This could happen if, for instance, the producer's records were deleted because their retention time had elapsed. Once the last records of the producerId are removed, the producer's metadata is removed from the broker, and future appends by the producer will return this exception. (Retriable: false)
                | ReassignmentInProgress -- ^ @60@ A partition reassignment is in progress. (Retriable: false)
                | DelegationTokenAuthDisabled -- ^ @61@ Delegation Token feature is not enabled. (Retriable: false)
                | DelegationTokenNotFound -- ^ @62@ Delegation Token is not found on server. (Retriable: false)
                | DelegationTokenOwnerMismatch -- ^ @63@ Specified Principal is not valid Owner/Renewer. (Retriable: false)
                | DelegationTokenRequestNotAllowed -- ^ @64@ Delegation Token requests are not allowed on PLAINTEXT/1-way SSL channels and on delegation token authenticated channels. (Retriable: xxx)
                | DelegationTokenAuthorizationFailed -- ^ @65@ Delegation Token authorization failed. (Retriable: false)
                | DelegationTokenExpired -- ^ @66@ Delegation Token is expired. (Retriable: false)
                | InvalidPrincipalType -- ^ @67@ Supplied principalType is not supported. (Retriable: false)
                | NonEmptyGroup -- ^ @68@ The group is not empty. (Retriable: false)
                | GroupIdNotFound -- ^ @69@ The group id does not exist. (Retriable: false)
                | FetchSessionIdNotFound -- ^ @70@ The fetch session ID was not found. (Retriable: true)
                | InvalidFetchSessionEpoch -- ^ @71@ The fetch session epoch is invalid. (Retriable: true)
                | ListenerNotFound -- ^ @72@ There is no listener on the leader broker that matches the listener on which metadata request was processed. (Retriable: true)
                | TopicDeletionDisabled -- ^ @73@ Topic deletion is disabled. (Retriable: false)
                | FencedLeaderEpoch -- ^ @74@ The leader epoch in the request is older than the epoch on the broker (Retriable: true)
                | UnknownLeaderEpoch -- ^ @75@ The leader epoch in the request is newer than the epoch on the broker (Retriable: true)
                | UnsupportedCompressionType -- ^ @76@ The requesting client does not support the compression type of given partition. (Retriable: false)
                | StaleBrokerEpoch -- ^ @77@ Broker epoch has changed (Retriable: false)
                | OffsetNotAvailable -- ^ @78@ The leader high watermark has not caught up from a recent leader election so the offsets cannot be guaranteed to be monotonically increasing (Retriable: xxx)
                | MemberIdRequired -- ^ @79@ The group member needs to have a valid member id before actually entering a consumer group (Retriable: xxx)
                | PreferredLeaderNotAvailable -- ^ @80@ The preferred leader was not available (Retriable: xxx)
                | GroupMaxSizeReached -- ^ @81@ The consumer group has reached its max size., GroupMaxSizeReachedException::new) (Retriable: xxx)
                | FencedInstanceId -- ^ @82@ The broker rejected this static consumer since another consumer with the same group.instance.id has registered with a different member.id. (Retriable: xxx)
                deriving (Bounded, Enum, Eq, Generic, Show)

instance Serializable KafkaError where
  serialize = serialize . errorKafka

instance Deserializable KafkaError where
  deserialize = do
    x <- deserialize :: Get Int16
    case x of
      0    -> return NoError
      (-1) -> return Unknown
      1    -> return OffsetOutOfRange
      2    -> return InvalidMessage
      3    -> return UnknownTopicOrPartition
      4    -> return InvalidMessageSize
      5    -> return LeaderNotAvailable
      6    -> return NotLeaderForPartition
      7    -> return RequestTimedOut
      8    -> return BrokerNotAvailable
      9    -> return ReplicaNotAvailable
      10   -> return MessageSizeTooLarge
      11   -> return StaleControllerEpochCode
      12   -> return OffsetMetadataTooLargeCode
      13   -> return NetworkException
      14   -> return OffsetsLoadInProgressCode
      15   -> return ConsumerCoordinatorNotAvailableCode
      16   -> return NotCoordinatorForConsumerCode
      17   -> return InvalidTopicException
      18   -> return RecordListTooLarge
      19   -> return NotEnoughReplicas
      20   -> return NotEnoughReplicasAfterAppend
      21   -> return InvalidRequiredAcks
      22   -> return IllegalGeneration
      23   -> return InconsistentGroupProtocol
      24   -> return InvalidGroupId
      25   -> return UnknownMemberId
      26   -> return InvalidSessionTimeout
      27   -> return RebalanceInProgress
      28   -> return InvalidCommitOffsetSize
      29   -> return TopicAuthorizationFailed
      30   -> return GroupAuthorizationFailed
      31   -> return ClusterAuthorizationFailed
      32   -> return InvalidTimestamp
      33   -> return UnsupportedSASLMechanism
      34   -> return IllegalSASLState
      35   -> return UnsupportedVersion
      36   -> return TopicAlreadyExists
      37   -> return InvalidPartitions
      38   -> return InvalidReplicationFactor
      39   -> return InvalidReplicaAssignment
      40   -> return InvalidConfig
      41   -> return NotController
      42   -> return InvalidRequest
      43   -> return UnsupportedForMessageFormat
      44   -> return PolicyViolation
      45   -> return OutOfOrderSequenceNumber
      46   -> return DuplicateSequenceNumber
      47   -> return InvalidProducerEpoch
      48   -> return InvalidTxnState
      49   -> return InvalidProducerIdMapping
      50   -> return InvalidTransactionTimeout
      51   -> return ConcurrentTransactions
      52   -> return TransactionCoordinatorFenced
      53   -> return TransactionalIdAuthorizationFailed
      54   -> return SecurityDisabled
      55   -> return OperationNotAttempted
      56   -> return KafkaStorageError
      57   -> return LogDirNotFound
      58   -> return SASLAuthenticationFailed
      59   -> return UnknownProducerId
      60   -> return ReassignmentInProgress
      61   -> return DelegationTokenAuthDisabled
      62   -> return DelegationTokenNotFound
      63   -> return DelegationTokenOwnerMismatch
      64   -> return DelegationTokenRequestNotAllowed
      65   -> return DelegationTokenAuthorizationFailed
      66   -> return DelegationTokenExpired
      67   -> return InvalidPrincipalType
      68   -> return NonEmptyGroup
      69   -> return GroupIdNotFound
      70   -> return FetchSessionIdNotFound
      71   -> return InvalidFetchSessionEpoch
      72   -> return ListenerNotFound
      73   -> return TopicDeletionDisabled
      74   -> return FencedLeaderEpoch
      75   -> return UnknownLeaderEpoch
      76   -> return UnsupportedCompressionType
      77   -> return StaleBrokerEpoch
      78   -> return OffsetNotAvailable
      79   -> return MemberIdRequired
      80   -> return PreferredLeaderNotAvailable
      81   -> return GroupMaxSizeReached
      82   -> return FencedInstanceId
      _    -> fail $ "invalid error code: " ++ show x

instance Exception KafkaError

newtype Request = Request (CorrelationId, ClientId, RequestMessage) deriving (Show, Eq, Generic)

instance Serializable Request where
  serialize (Request (correlationId, clientId, r)) = do
    serialize (apiKey r)
    serialize (apiVersion r)
    serialize correlationId
    serialize clientId
    serialize r

requestBytes :: Request -> ByteString
requestBytes x = runPut $ do
  putWord32be . fromIntegral $ B.length mr
  putByteString mr
    where mr = runPut $ serialize x

apiVersion :: RequestMessage -> ApiVersion
apiVersion OffsetFetchRequest{}  = 1 -- have to be V1 to use kafka storage to allow metadata
apiVersion OffsetCommitRequest{} = 2 -- use V2 commit to not deal with Timestamps, and get stored in Kafka
apiVersion _                     = ApiVersion 0 -- everything else is at version 0 right now

apiKey :: RequestMessage -> ApiKey
apiKey ProduceRequest{} = ApiKey 0
apiKey FetchRequest{} = ApiKey 1
apiKey OffsetRequest{} = ApiKey 2
apiKey MetadataRequest{} = ApiKey 3
apiKey OffsetCommitRequest{} = ApiKey 8
apiKey OffsetFetchRequest{} = ApiKey 9
apiKey GroupCoordinatorRequest{} = ApiKey 10
apiKey HeartbeatRequest{} = ApiKey 12
apiKey CreateTopicsRequest{} = ApiKey 19
apiKey DeleteTopicsRequest{} = ApiKey 20

instance Serializable RequestMessage where
  serialize (ProduceRequest r) = serialize r
  serialize (FetchRequest r) = serialize r
  serialize (OffsetRequest r) = serialize r
  serialize (MetadataRequest r) = serialize r
  serialize (OffsetCommitRequest r) = serialize r
  serialize (OffsetFetchRequest r) = serialize r
  serialize (GroupCoordinatorRequest r) = serialize r
  serialize (CreateTopicsRequest r) = serialize r
  serialize (DeleteTopicsRequest r) = serialize r
  serialize (HeartbeatRequest r) = serialize r

instance Serializable Int64 where serialize = putWord64be . fromIntegral
instance Serializable Int32 where serialize = putWord32be . fromIntegral
instance Serializable Int16 where serialize = putWord16be . fromIntegral
instance Serializable Int8  where serialize = putWord8    . fromIntegral

instance Serializable Key where
  serialize (Key (Just bs)) = serialize bs
  serialize (Key Nothing)   = serialize (-1 :: Int32)

instance Serializable Value where
  serialize (Value (Just bs)) = serialize bs
  serialize (Value Nothing)   = serialize (-1 :: Int32)

instance Serializable KafkaString where
  serialize (KString bs) = do
    let l = fromIntegral (B.length bs) :: Int16
    serialize l
    putByteString bs

instance Serializable MessageSet where
  serialize (MessageSet codec messageSet) = do
    let bytes = runPut $ mapM_ serialize (compress codec messageSet)
        l = fromIntegral (B.length bytes) :: Int32
    serialize l
    putByteString bytes

    where compress :: CompressionCodec -> [MessageSetMember] -> [MessageSetMember]
          compress NoCompression ms = ms
          compress c ms = [MessageSetMember (Offset (-1)) (message c ms)]

          message :: CompressionCodec -> [MessageSetMember] -> Message
          message c ms = Message (0, 0, Attributes c, Key Nothing, value (compressor c) ms)

          compressor :: CompressionCodec -> (ByteString -> ByteString)
          compressor c = case c of
            Gzip -> LB.toStrict . GZip.compress . LB.fromStrict
            _ -> fail "Unsupported compression codec"

          value :: (ByteString -> ByteString) -> [MessageSetMember] -> Value
          value c ms = Value . Just . KBytes $ c (runPut $ mapM_ serialize ms)

instance Serializable Attributes where
  serialize = serialize . bits
    where bits :: Attributes -> Int8
          bits = codecValue . _compressionCodec

          codecValue :: CompressionCodec -> Int8
          codecValue NoCompression = 0
          codecValue Gzip = 1

instance Serializable KafkaBytes where
  serialize (KBytes bs) = do
    let l = fromIntegral (B.length bs) :: Int32
    serialize l
    putByteString bs

instance Serializable MessageSetMember where
  serialize (MessageSetMember offset msg) = do
    serialize offset
    serialize msize
    serialize msg
      where msize = fromIntegral $ B.length $ runPut $ serialize msg :: Int32

instance Serializable Message where
  serialize (Message (_, magic, attrs, k, v)) = do
    let m = runPut $ serialize magic >> serialize attrs >> serialize k >> serialize v
    putWord32be (crc32 m)
    putByteString m

instance (Serializable a) => Serializable [a] where
  serialize xs = do
    let l = fromIntegral (length xs) :: Int32
    serialize l
    mapM_ serialize xs

instance (Serializable a, Serializable b) => Serializable ((,) a b) where
  serialize (x, y) = serialize x >> serialize y
instance (Serializable a, Serializable b, Serializable c) => Serializable ((,,) a b c) where
  serialize (x, y, z) = serialize x >> serialize y >> serialize z
instance (Serializable a, Serializable b, Serializable c, Serializable d) => Serializable ((,,,) a b c d) where
  serialize (w, x, y, z) = serialize w >> serialize x >> serialize y >> serialize z
instance (Serializable a, Serializable b, Serializable c, Serializable d, Serializable e) => Serializable ((,,,,) a b c d e) where
  serialize (v, w, x, y, z) = serialize v >> serialize w >> serialize x >> serialize y >> serialize z

instance Deserializable MessageSet where
  deserialize = do
    l <- deserialize :: Get Int32
    ms <- isolate (fromIntegral l) getMembers

    decompressed <- mapM decompress ms

    return $ MessageSet NoCompression (concat decompressed)

      where getMembers :: Get [MessageSetMember]
            getMembers = do
              wasEmpty <- isEmpty
              if wasEmpty
              then return []
              else liftM2 (:) deserialize getMembers <|> (remaining >>= getBytes >> return [])

            decompress :: MessageSetMember -> Get [MessageSetMember]
            decompress m = if isCompressed m
                  then decompressSetMember m
                  else return [m]

            isCompressed :: MessageSetMember -> Bool
            isCompressed = messageCompressed . _setMessage

            messageCompressed :: Message -> Bool
            messageCompressed (Message (_, _, att, _, _)) = _compressionCodec att /= NoCompression

            decompressSetMember :: MessageSetMember -> Get [MessageSetMember]
            decompressSetMember (MessageSetMember _ (Message (_, _, att, _, Value v))) = case v of
              Just bytes -> decompressMessage (decompressor att) (_kafkaByteString bytes)
              Nothing -> fail "Expecting a compressed message set, empty data set received"

            decompressor :: Attributes -> (ByteString -> ByteString)
            decompressor att = case _compressionCodec att of
              Gzip -> LB.toStrict . GZip.decompress . LB.fromStrict
              _ -> fail "Unsupported compression codec."

            decompressMessage :: (ByteString -> ByteString) -> ByteString -> Get [MessageSetMember]
            decompressMessage f = getDecompressedMembers . f

            getDecompressedMembers :: ByteString -> Get [MessageSetMember]
            getDecompressedMembers "" = return [] -- a compressed empty message
            getDecompressedMembers val = do
              let res = runGetPartial deserialize val :: Result MessageSetMember
              case res of
                Fail err _ -> fail err
                Partial _ -> fail "Could not consume all available data"
                Done v vv -> fmap (v :) (getDecompressedMembers vv)

instance Deserializable MessageSetMember where
  deserialize = do
    o <- deserialize
    l <- deserialize :: Get Int32
    m <- isolate (fromIntegral l) deserialize
    return $ MessageSetMember o m

instance Deserializable Leader where
  deserialize = do
    x <- deserialize :: Get Int32
    let l = Leader $ if x == -1 then Nothing else Just x
    return l

instance Deserializable Attributes where
  deserialize = do
    i <- deserialize :: Get Int8
    codec <- case compressionCodecFromValue i of
      Just c -> return c
      Nothing -> fail $ "Unknown compression codec value found in: " ++ show i
    return $ Attributes codec

compressionCodecFromValue :: Int8 -> Maybe CompressionCodec
compressionCodecFromValue i | eq 1 = Just Gzip
                            | eq 0 = Just NoCompression
                            | otherwise = Nothing
                            where eq y = i .&. y == y

instance Deserializable KafkaBytes where
  deserialize = do
    l <- deserialize :: Get Int32
    bs <- getByteString $ fromIntegral l
    return $ KBytes bs

instance Deserializable KafkaString where
  deserialize = do
    l <- deserialize :: Get Int16
    bs <- getByteString $ fromIntegral l
    return $ KString bs

instance Deserializable Key where
  deserialize = do
    l <- deserialize :: Get Int32
    case l of
      -1 -> return (Key Nothing)
      _ -> do
        bs <- getByteString $ fromIntegral l
        return $ Key (Just (KBytes bs))

instance Deserializable Value where
  deserialize = do
    l <- deserialize :: Get Int32
    case l of
      -1 -> return (Value Nothing)
      _ -> do
        bs <- getByteString $ fromIntegral l
        return $ Value (Just (KBytes bs))

instance (Deserializable a) => Deserializable [a] where
  deserialize = do
    l <- deserialize :: Get Int32
    replicateM (fromIntegral l) deserialize

instance (Deserializable a, Deserializable b) => Deserializable ((,) a b) where
  deserialize = liftM2 (,) deserialize deserialize
instance (Deserializable a, Deserializable b, Deserializable c) => Deserializable ((,,) a b c) where
  deserialize = liftM3 (,,) deserialize deserialize deserialize
instance (Deserializable a, Deserializable b, Deserializable c, Deserializable d) => Deserializable ((,,,) a b c d) where
  deserialize = liftM4 (,,,) deserialize deserialize deserialize deserialize
instance (Deserializable a, Deserializable b, Deserializable c, Deserializable d, Deserializable e) => Deserializable ((,,,,) a b c d e) where
  deserialize = liftM5 (,,,,) deserialize deserialize deserialize deserialize deserialize

instance Deserializable Int64 where deserialize = fmap fromIntegral getWord64be
instance Deserializable Int32 where deserialize = fmap fromIntegral getWord32be
instance Deserializable Int16 where deserialize = fmap fromIntegral getWord16be
instance Deserializable Int8  where deserialize = fmap fromIntegral getWord8

-- * Generated lenses

makeLenses ''TopicName

makeLenses ''KafkaBytes
makeLenses ''KafkaString

makeLenses ''ProduceResponse

makeLenses ''OffsetResponse
makeLenses ''PartitionOffsets

makeLenses ''FetchResponse

makeLenses ''MetadataResponse
makeLenses ''Broker
makeLenses ''NodeId
makeLenses ''Host
makeLenses ''Port
makeLenses ''TopicMetadata
makeLenses ''PartitionMetadata
makeLenses ''Leader

makeLenses ''Time

makeLenses ''Partition

makeLenses ''MessageSet
makeLenses ''MessageSetMember
makeLenses ''Offset

makeLenses ''Message

makeLenses ''Key
makeLenses ''Value

makeLenses ''CreateTopicsResponse

makePrisms ''ResponseMessage

-- * Composed lenses

keyed :: (Field1 a a b b, Choice p, Applicative f, Eq b) => b -> Optic' p f a a
keyed k = filtered (view $ _1 . to (== k))

metadataResponseBrokers :: Lens' MetadataResponse [Broker]
metadataResponseBrokers = metadataResponseFields . _1

topicsMetadata :: Lens' MetadataResponse [TopicMetadata]
topicsMetadata = metadataResponseFields . _2

topicMetadataKafkaError :: Lens' TopicMetadata KafkaError
topicMetadataKafkaError = topicMetadataFields . _1

topicMetadataName :: Lens' TopicMetadata TopicName
topicMetadataName = topicMetadataFields . _2

partitionsMetadata :: Lens' TopicMetadata [PartitionMetadata]
partitionsMetadata = topicMetadataFields . _3

partitionId :: Lens' PartitionMetadata Partition
partitionId = partitionMetadataFields . _2

partitionMetadataLeader :: Lens' PartitionMetadata Leader
partitionMetadataLeader = partitionMetadataFields . _3

brokerNode :: Lens' Broker NodeId
brokerNode = brokerFields . _1

brokerHost :: Lens' Broker Host
brokerHost = brokerFields . _2

brokerPort :: Lens' Broker Port
brokerPort = brokerFields . _3

fetchResponseMessages :: Fold FetchResponse MessageSet
fetchResponseMessages = fetchResponseFields . folded . _2 . folded . _4

fetchResponseByTopic :: TopicName -> Fold FetchResponse (Partition, KafkaError, Offset, MessageSet)
fetchResponseByTopic t = fetchResponseFields . folded . keyed t . _2 . folded

messageSetByPartition :: Partition -> Fold (Partition, KafkaError, Offset, MessageSet) MessageSetMember
messageSetByPartition p = keyed p . _4 . messageSetMembers . folded

fetchResponseMessageMembers :: Fold FetchResponse MessageSetMember
fetchResponseMessageMembers = fetchResponseMessages . messageSetMembers . folded

messageKey :: Lens' Message Key
messageKey = messageFields . _4

messageKeyBytes :: Fold Message ByteString
messageKeyBytes = messageKey . keyBytes . folded . kafkaByteString

messageValue :: Lens' Message Value
messageValue = messageFields . _5

payload :: Fold Message ByteString
payload = messageValue . valueBytes . folded . kafkaByteString

offsetResponseOffset :: Partition -> Fold OffsetResponse Offset
offsetResponseOffset p = offsetResponseFields . folded . _2 . folded . partitionOffsetsFields . keyed p . _3 . folded

messageSet :: Partition -> TopicName -> Fold FetchResponse MessageSetMember
messageSet p t = fetchResponseByTopic t . messageSetByPartition p

nextOffset :: Lens' MessageSetMember Offset
nextOffset = setOffset . adding 1

findPartitionMetadata :: Applicative f => TopicName -> LensLike' f TopicMetadata [PartitionMetadata]
findPartitionMetadata t = filtered (view $ topicMetadataName . to (== t)) . partitionsMetadata

findPartition :: Partition -> Prism' PartitionMetadata PartitionMetadata
findPartition p = filtered (view $ partitionId . to (== p))

hostString :: Lens' Host String
hostString = hostKString . kString . unpackedChars

portId :: IndexPreservingGetter Port Network.PortID
portId = portInt . to fromIntegral . to Network.PortNumber
