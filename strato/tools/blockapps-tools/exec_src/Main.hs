{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# OPTIONS_GHC -Wall #-}

--import BlockApps.Tools.Checkpoints
import BlockApps.Tools.Code as Code
import BlockApps.Tools.DumpKafkaSequencer
import BlockApps.Tools.DumpKafkaStateDiff
import BlockApps.Tools.DumpKafkaUnSequencer
import BlockApps.Tools.DumpKafkaVMEvents
import BlockApps.Tools.DumpRedis
import BlockApps.Tools.FRawMP as FRawMP
import BlockApps.Tools.Hash as Hash
import BlockApps.Tools.InsertP2P
import BlockApps.Tools.InsertSeq
import BlockApps.Tools.Psql
import BlockApps.Tools.RLP as RLP
import BlockApps.Tools.Raw as Raw
import BlockApps.Tools.RawMP as RawMP
import BlockApps.Tools.Redis
import BlockApps.Tools.State as State
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Participation
import Blockchain.Sequencer.Event
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Keccak256 hiding (hash)
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import qualified Data.Text as T
import qualified LabeledError
import System.Console.CmdArgs
import System.Process

data Options
  = AddTx {txJson :: String}
  | AddBlocksFromFile {fileName :: String}
  | AddGenesisFromFile {fileName :: String}
  | AddTxsFromFile {fileName :: String}
  | AskForBlocks {startBlock :: Integer, endBlock :: Integer, qOrg :: String, qOrgUnit :: String, qCommonName :: String}
  | AskForTxs
  | ChainHash
--  | Checkpoints {service :: CheckpointService, operation :: CheckpointOperation, offset :: Maybe Int64, cp :: Maybe String}
  | Code {hash :: String}
  | DeleteDepBlock {valK :: String}
  | DumpKafkaVMEvents {startingBlock :: Int}
  | DumpKafkaSequencer {startingBlock :: Int}
  | DumpKafkaSequencerVM {startingBlock :: Int}
  | DumpKafkaSequencerP2P {startingBlock :: Int}
  | DumpKafkaUnSequencer {startingBlock :: Int}
--  | DumpKafkaRaw {streamName :: String, startingBlock :: Int}
  | DumpKafkaStateDiff {startingBlock :: Int}
  | DumpRedis {databaseNumber :: Integer}
  | FRawMP {stateRoot :: String, filename :: String}
  | Hash {hash :: String}
  | InsertTX {}
  | Migrate {tables :: String}
  | PushBlocks {startBlock :: Integer, endBlock :: Integer, qOrg :: String, qOrgUnit :: String, qCommonName :: String}
  | Raw {filename :: String}
  | RawMP {stateRoot :: String, filename :: String}
  | RLP {filename :: String}
  | Redis {key :: String}
  | RedisMatch {pattern :: String}
  | SetParticipationMode {mode :: ParticipationMode}
  | State {root :: String}
  | ValidatorBehavior {valB :: Bool}
  | GetPrivacy {registry :: String, key :: String}
  | PutPrivacy {registry :: String, key :: String, value :: String}
  deriving (Show, Data, Typeable)

stateOptions :: Annotate Ann
stateOptions =
  record
    State {root = undefined}
    [ root := def += typ "StateRoot" += argPos 0 ]

dumpRedisOptions :: Annotate Ann
dumpRedisOptions =
  record
    DumpRedis {databaseNumber = undefined}
    [ databaseNumber := 0 += typ "INT"
    ]

hashOptions :: Annotate Ann
hashOptions =
  record
    Hash {hash = undefined}
    [ hash := def += typ "FILENAME" += argPos 0 += opt ("-" :: String)
    ]

codeOptions :: Annotate Ann
codeOptions =
  record
    Code {hash = undefined}
    [ hash := def += typ "USERAGENT" += argPos 0
    ]

rawOptions :: Annotate Ann
rawOptions =
  record
    Raw {filename = undefined}
    [ filename := def += typ "DBSTRING" += argPos 0
    ]

rlpOptions :: Annotate Ann
rlpOptions =
  record
    RLP {filename = undefined}
    [ filename := def += typ "DBSTRING" += argPos 0
    ]

rawMPOptions :: Annotate Ann
rawMPOptions =
  record
    RawMP {stateRoot = undefined, filename = undefined}
    [ stateRoot := def += typ "USERAGENT" += argPos 1,
      filename := def += typ "DBSTRING" += argPos 0
    ]

fRawMPOptions :: Annotate Ann
fRawMPOptions =
  record
    FRawMP {stateRoot = undefined, filename = undefined}
    [ stateRoot := def += typ "USERAGENT" += argPos 1,
      filename := def += typ "DBSTRING" += argPos 0
    ]

dumpKafkaSequencerOptions :: Annotate Ann
dumpKafkaSequencerOptions =
  record
    DumpKafkaSequencer {startingBlock = undefined}
    [ startingBlock := 0 += typ "INT"
    ]

dumpKafkaSequencerVmOptions :: Annotate Ann
dumpKafkaSequencerVmOptions =
  record
    DumpKafkaSequencerVM {startingBlock = undefined}
    [ startingBlock := 0 += typ "INT"
    ]

dumpKafkaSequencerP2pOptions :: Annotate Ann
dumpKafkaSequencerP2pOptions =
  record
    DumpKafkaSequencerP2P {startingBlock = undefined}
    [ startingBlock := 0 += typ "INT"
    ]

dumpKafkaUnSequencerOptions :: Annotate Ann
dumpKafkaUnSequencerOptions =
  record
    DumpKafkaUnSequencer {startingBlock = undefined}
    [ startingBlock := 0 += typ "INT"
    ]

dumpKafkaVMEventsOptions :: Annotate Ann
dumpKafkaVMEventsOptions =
  record
    DumpKafkaVMEvents {startingBlock = undefined}
    [ startingBlock := 0 += typ "INT"
    ]
{-
dumpKafkaRawOptions :: Annotate Ann
dumpKafkaRawOptions =
  record
    DumpKafkaRaw {startingBlock = undefined, streamName = undefined}
    [ startingBlock := 0 += typ "INT" += argPos 1,
      streamName := def += typ "DBSTRING" += argPos 0
    ]
-}
dumpKafkaStateDiffOptions :: Annotate Ann
dumpKafkaStateDiffOptions =
  record
    DumpKafkaStateDiff {startingBlock = undefined}
    [ startingBlock := 0 += typ "INT"
    ]

insertTXOptions :: Annotate Ann
insertTXOptions =
  record InsertTX {} []
{-
checkpointOptions :: Annotate Ann
checkpointOptions =
  record
    Checkpoints {service = nil, operation = nil, offset = nil, cp = nil}
    [ service := NullService += typ "SERVICE" += explicit += name "s" += name "service",
      operation := NullOperation += typ "OP" += explicit += name "o" += name "op",
      offset := Nothing += typ "INT" += explicit += name "i" += name "offset",
      cp := Nothing += typ "DATA" += explicit += name "m" += name "metadata"
    ]
  where
    nil = undefined
-}
askOptions :: Annotate Ann
askOptions =
  record
    AskForBlocks {startBlock = error "unused start block", endBlock = error "unused end block", qOrg = "", qOrgUnit = "", qCommonName = ""}
    [ startBlock := error "--start-block required" += typ "NUMBER" += explicit += name "start-block",
      endBlock := error "--end-block required" += typ "NUMBER" += explicit += name "end-block",
      qOrg := "" += typ "STRING" += explicit += name "org",
      qOrgUnit := "" += typ "STRING" += explicit += name "orgUnit",
      qCommonName := "" += typ "STRING" += explicit += name "commonName"
    ]

pushOptions :: Annotate Ann
pushOptions =
  record
    PushBlocks {startBlock = error "unused start block", endBlock = error "unused end block", qOrg = "", qOrgUnit = "", qCommonName = ""}
    [ startBlock := error "--start-block required" += typ "NUMBER" += explicit += name "start-block",
      endBlock := error "--end-block required" += typ "NUMBER" += explicit += name "end-block",
      qOrg := "" += typ "STRING" += explicit += name "org",
      qOrgUnit := "" += typ "STRING" += explicit += name "orgUnit",
      qCommonName := "" += typ "STRING" += explicit += name "commonName"
    ]

askForTxOptions :: Annotate Ann
askForTxOptions = record AskForTxs []

redisOptions :: Annotate Ann
redisOptions =
  record
    Redis {key = error "unused key"}
    [ key := error "redis <KEY>" += typ "KEY" += argPos 0
    ]

redisMatchOptions :: Annotate Ann
redisMatchOptions =
  record
    RedisMatch {pattern = error "unused pattern"}
    [ pattern := error "redis <PATTERN>" += typ "PATTERN" += argPos 0
    ]

migrateOptions :: Annotate Ann
migrateOptions =
  record
    Migrate {tables = error "unused tables"}
    [ tables := error "migrate (data|global|peer|all)" += typ "TABLES" += argPos 0
    ]

addTxOptions :: Annotate Ann
addTxOptions =
  record
    AddTx {txJson = error "unused txJson"}
    [ txJson := error "addtx --tx=<json>" += typ "JSON" += explicit += name "tx"
    ]

addBlocksFromFileOptions :: Annotate Ann
addBlocksFromFileOptions =
  record
    AddBlocksFromFile {fileName = error "unused fileName"}
    [ fileName := error "addblocksfromfile --file-name=<file-name>" += typ "STRING" += explicit += name "file-name"
    ]

addGenesisFromFileOptions :: Annotate Ann
addGenesisFromFileOptions =
  record
    AddGenesisFromFile {fileName = error "unused fileName"}
    [ fileName := error "addgenesisfromfile --file-name=<file-name>" += typ "STRING" += explicit += name "file-name"
    ]

addTxsFromFileOptions :: Annotate Ann
addTxsFromFileOptions =
  record
    AddTxsFromFile {fileName = error "unused fileName"}
    [ fileName := error "addtxsfromfile --file-name=<file-name>" += typ "STRING" += explicit += name "file-name"
    ]

validatorBehaviorOptions :: Annotate Ann
validatorBehaviorOptions =
  record
    ValidatorBehavior {valB = undefined}
    [ valB := error "valB" += typ "BOOL" += argPos 0
    ]

deleteDepBlockOptions :: Annotate Ann
deleteDepBlockOptions =
  record
    DeleteDepBlock {valK = undefined}
    [ valK := error "valK" += typ "STRING" += argPos 0
    ]

setParticipationModeOptions :: Annotate Ann
setParticipationModeOptions =
  record
    SetParticipationMode {mode = error "unused participationMode"}
    [ mode := error "setparticipationmode --mode=(Full|None|NoConsensus)"
        += typ "PARTICIPTIONMODE"
        += explicit
        += name "mode"
    ]

chainHashOptions :: Annotate Ann
chainHashOptions = record ChainHash []

getPrivacyOptions :: Annotate Ann
getPrivacyOptions =
  record
    GetPrivacy {registry = error "unused registry", key = error "unused key"}
    [ registry := error "getprivacy --registry=<registry>" += typ "STRING" += explicit += name "registry",
      key := error "getprivacy --key=<key>" += typ "STRING" += explicit += name "key"
    ]

putPrivacyOptions :: Annotate Ann
putPrivacyOptions =
  record
    PutPrivacy {registry = error "unused registry", key = error "unused key", value = error "unused value"}
    [ registry := error "putprivacy --registry=<registry>" += typ "STRING" += explicit += name "registry",
      key := error "putprivacy --key=<key>" += typ "STRING" += explicit += name "key",
      value := error "putprivacy --value=<value>" += typ "STRING" += explicit += name "value"
    ]

options :: Annotate Ann
options =
  modes_
    [
      addBlocksFromFileOptions,
      addGenesisFromFileOptions,
      addTxsFromFileOptions,
      addTxOptions,
      askOptions,
      askForTxOptions,
      chainHashOptions,
--      checkpointOptions,
      codeOptions,
      dumpKafkaVMEventsOptions,
--      dumpKafkaRawOptions,
      dumpKafkaSequencerOptions,
      dumpKafkaSequencerVmOptions,
      dumpKafkaSequencerP2pOptions,
      dumpKafkaStateDiffOptions,
      dumpKafkaUnSequencerOptions,
      dumpRedisOptions,
      fRawMPOptions,
      hashOptions,
      insertTXOptions,
      rawMPOptions,
      rawOptions,
      redisOptions,
      redisMatchOptions,
      rlpOptions,
      migrateOptions,
      pushOptions,
      stateOptions,
      validatorBehaviorOptions,
      deleteDepBlockOptions,
      setParticipationModeOptions,
      getPrivacyOptions,
      putPrivacyOptions
    ]


main :: IO ()
main = do
  -- the tools should use /tmp/.ethereumH/ to access levelDB data 
  -- while avoiding the LOCK while the node is running
  let (cmd, args') = ("cp", ["-r", "/var/lib/strato/.ethereumH/", "/tmp/.ethereumH/"])
  (_, _, _, processHandle) <- createProcess (proc cmd args')
  _ <- waitForProcess processHandle
  opts <- cmdArgs_ options
  run opts


run :: Options -> IO ()
run AddTx {..} = addTx txJson
run AddBlocksFromFile {..} = addBlocksFromFile fileName
run AddGenesisFromFile {} = error "strato-barometer: the addGenesisFromFile tool has been deprecated."
run AddTxsFromFile {..} = addTxsFromFile fileName
run AskForBlocks {..} =
  let i = CommonName (T.pack qOrg) (T.pack qOrgUnit) (T.pack qCommonName) True
   in insertP2P (P2pAskForBlocks startBlock endBlock i)
run AskForTxs =
  insertP2P . P2pGetTx
    . map (unsafeCreateKeccak256FromByteString . LabeledError.b16Decode "strato-barometer/askForTxs")
    . filter (not . B.null)
    . BC.split '\n'
    =<< B.getContents
run ChainHash = error "strato-barometer: the chainhash tool has been deprecated."
--run Checkpoints {..} = case operation of
--  Get -> doCheckpointGet service
--  Put -> doCheckpointPut service (fromIntegral <$> offset) cp
--  NullOperation -> doCheckpointUsage
run Code {..} = Code.doit hash
run DeleteDepBlock {..} = deleteDepBlock valK
run DumpKafkaSequencer {..} = dumpKafkaSequencer (fromIntegral startingBlock)
run DumpKafkaSequencerVM {..} = dumpKafkaSequencerVM (fromIntegral startingBlock)
run DumpKafkaSequencerP2P {..} = dumpKafkaSequencerP2P (fromIntegral startingBlock)
run DumpKafkaUnSequencer {..} = dumpKafkaUnSequencer (fromIntegral startingBlock)
run DumpKafkaVMEvents {..} = dumpKafkaVMEvents (fromIntegral startingBlock)
--run DumpKafkaRaw {..} = dumpKafkaRaw streamName (fromIntegral startingBlock)
run DumpKafkaStateDiff {..} = dumpKafkaStateDiff $ fromIntegral startingBlock
run DumpRedis {..} = dumpRedis databaseNumber
run InsertTX {} = error "strato-barometer: the insertTx tool has been deprecated."
run Hash {..} = Hash.doit hash
run Raw {..} = Raw.doit filename
run Redis {..} = redis $ BC.pack key
run RedisMatch {..} = redisMatch $ BC.pack pattern
run RLP {..} = RLP.doit filename
run RawMP {..} = RawMP.doit filename (MP.StateRoot . LabeledError.b16Decode "strato-barometer/RawMP" $ BC.pack stateRoot)
run FRawMP {..} = FRawMP.doit filename (MP.StateRoot . LabeledError.b16Decode "strato-barometer/FRawMP" $ BC.pack stateRoot)
run PushBlocks {..} =
  let i = CommonName (T.pack qOrg) (T.pack qOrgUnit) (T.pack qCommonName) True
   in insertP2P (P2pPushBlocks startBlock endBlock i)
run SetParticipationMode {..} = remoteSetParticipationMode mode
run State {..} = let sr = MP.StateRoot $ LabeledError.b16Decode "strato-barometer/state" $ BC.pack root in State.doit sr
run ValidatorBehavior {..} = validatorBehavior valB
run Migrate {..} = migrate tables
run GetPrivacy {} = error "strato-barometer: the getPrivacy tool has been deprecated."
run PutPrivacy {} = error "strato-barometer: the putPrivacy tool has been deprecated."
