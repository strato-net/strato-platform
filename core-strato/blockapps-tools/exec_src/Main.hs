{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE OverloadedStrings  #-}
{-# LANGUAGE RecordWildCards    #-}
{-# OPTIONS_GHC -Wall #-}

import           System.Console.CmdArgs

import           Block
import           BlockGO
import           Checkpoints
import           Code
import           DumpKafkaBlocks
import           CanonRedis
import           DumpKafkaRaw
import           DumpKafkaSequencer
import           DumpKafkaStateDiff
import           DumpKafkaUnminedBlocks
import           DumpKafkaUnSequencer
import           DumpRedis
import           FRawMP
import           Hash
import           InsertP2P
import           InsertTX
import           Psql
import           Raw
import           RawMP
import           RLP
import           State

import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.Sequencer.Event
import           Blockchain.Strato.Model.Address
import qualified Data.ByteString.Base16             as B16
import qualified Data.ByteString.Char8              as BC
import           Data.Int

data Options = State{root::String, db::String}
             | Block{hash::String, db::String}
             | BlockGO{hash::String, db::String}
             | Hash{hash::String, db::String}
             | Code{hash::String, db::String}
             | RawMP{stateRoot::String, filename::String}
             | FRawMP{stateRoot::String, filename::String}
             | Raw{filename::String}
             | RLP{filename::String}
             | Checkpoints{service :: CheckpointService, operation :: CheckpointOperation, offset :: Maybe Int64, cp :: Maybe String}
             | DumpKafkaBlocks{startingBlock::Int}
             | DumpKafkaSequencer{startingBlock::Int}
             | DumpKafkaSequencerVM{startingBlock::Int}
             | DumpKafkaSequencerP2P{startingBlock::Int}
             | DumpKafkaUnSequencer{startingBlock::Int}
             | DumpKafkaUnminedBlocks{startingBlock::Int}
             | DumpKafkaRaw{streamName::String, startingBlock::Int}
             | DumpKafkaStateDiff{startingBlock::Int}
             | DumpRedis{databaseNumber::Integer}
             | CanonRedis{ipAddress::String, start::Int, range::Int}
             | Psql{}
             | InsertTX{}
             | AskForBlocks{startBlock::Integer, endBlock::Integer, peer::Address}
             | PushBlocks{startBlock::Integer, endBlock::Integer, peer::Address}
             deriving (Show, Data, Typeable)

stateOptions::Annotate Ann
stateOptions =
  record State{root=undefined, db=undefined} [
    root := def += typ "StateRoot" += argPos 1,
    db := def += typ "DBSTRING" += argPos 0
    ]

canonRedisOptions :: Annotate Ann
canonRedisOptions =
  record CanonRedis{ipAddress=undefined, start=undefined, range=undefined} [
    ipAddress := def += typ "IPADDRESS" += argPos 0,
    start := def += typ "STARTINGBLOCK" += argPos 1,
    range := def += typ "RANGE" += argPos 2
  ]

redisOptions :: Annotate Ann
redisOptions =
  record DumpRedis{databaseNumber=undefined} [
    databaseNumber := 0 += typ "INT"
  ]

blockOptions::Annotate Ann
blockOptions =
  record Block{hash=undefined, db=undefined} [
    hash := def += typ "FILENAME" += argPos 1 += opt ("-"::String),
    db := def += typ "DBSTRING" += argPos 0
    ]

blockGoOptions::Annotate Ann
blockGoOptions =
  record BlockGO{hash=undefined, db=undefined} [
    hash := def += typ "FILENAME" += argPos 1 += opt ("-"::String),
    db := def += typ "DBSTRING" += argPos 0
    ]

hashOptions::Annotate Ann
hashOptions =
  record Hash{hash=undefined, db=undefined} [
    hash := def += typ "FILENAME" += argPos 1 += opt ("-"::String),
    db := def += typ "DBSTRING" += argPos 0
    ]

codeOptions::Annotate Ann
codeOptions =
  record Code{hash=undefined, db=undefined} [
    hash := def += typ "USERAGENT" += argPos 1,
    db := def += typ "DBSTRING" += argPos 0
    ]

rawOptions::Annotate Ann
rawOptions =
  record Raw{filename=undefined} [
    filename := def += typ "DBSTRING" += argPos 0
    ]

rlpOptions::Annotate Ann
rlpOptions =
  record RLP{filename=undefined} [
    filename := def += typ "DBSTRING" += argPos 0
    ]

rawMPOptions::Annotate Ann
rawMPOptions =
  record RawMP{stateRoot=undefined, filename=undefined} [
    stateRoot := def += typ "USERAGENT" += argPos 1,
    filename := def += typ "DBSTRING" += argPos 0
    ]

fRawMPOptions::Annotate Ann
fRawMPOptions =
  record FRawMP{stateRoot=undefined, filename=undefined} [
    stateRoot := def += typ "USERAGENT" += argPos 1,
    filename := def += typ "DBSTRING" += argPos 0
    ]

dumpKafkaSequencerOptions:: Annotate Ann
dumpKafkaSequencerOptions =
  record DumpKafkaSequencer{startingBlock = undefined} [
    startingBlock := 0 += typ "INT"
    ]

dumpKafkaSequencerVmOptions:: Annotate Ann
dumpKafkaSequencerVmOptions =
  record DumpKafkaSequencerVM{startingBlock = undefined} [
    startingBlock := 0 += typ "INT"
    ]

dumpKafkaSequencerP2pOptions:: Annotate Ann
dumpKafkaSequencerP2pOptions =
  record DumpKafkaSequencerP2P{startingBlock = undefined} [
    startingBlock := 0 += typ "INT"
    ]

dumpKafkaUnSequencerOptions:: Annotate Ann
dumpKafkaUnSequencerOptions =
  record DumpKafkaUnSequencer{startingBlock = undefined} [
    startingBlock := 0 += typ "INT"
    ]

dumpKafkaBlocksOptions::Annotate Ann
dumpKafkaBlocksOptions =
  record DumpKafkaBlocks{startingBlock=undefined} [
    startingBlock := 0 += typ "INT"
    ]

dumpKafkaUnminedBlocksOptions::Annotate Ann
dumpKafkaUnminedBlocksOptions =
  record DumpKafkaUnminedBlocks{startingBlock=undefined} [
    startingBlock := 0 += typ "INT"
    ]

dumpKafkaRawOptions::Annotate Ann
dumpKafkaRawOptions =
  record DumpKafkaRaw{startingBlock=undefined, streamName=undefined} [
    startingBlock := 0 += typ "INT" += argPos 1,
    streamName := def += typ "DBSTRING" += argPos 0
    ]

dumpKafkaStateDiffOptions::Annotate Ann
dumpKafkaStateDiffOptions =
  record DumpKafkaStateDiff{startingBlock=undefined} [
    startingBlock := 0 += typ "INT"
    ]

psqlOptions::Annotate Ann
psqlOptions =
  record Psql{} []

insertTXOptions::Annotate Ann
insertTXOptions =
  record InsertTX{} []

checkpointOptions :: Annotate Ann
checkpointOptions =
    record Checkpoints{service = nil, operation = nil, offset = nil, cp = nil}
        [ service   := NullService   += typ "SERVICE" += explicit += name "s" += name "service"
        , operation := NullOperation += typ "OP"      += explicit += name "o" += name "op"
        , offset    := Nothing       += typ "INT"     += explicit += name "i" += name "offset"
        , cp        := Nothing       += typ "DATA"    += explicit += name "m" += name "metadata"
        ]
    where nil = undefined

askOptions :: Annotate Ann
askOptions =
  record AskForBlocks{startBlock=error "unused start block", endBlock=error "unused end block", peer = 0x0}
         [ startBlock := error "--start-block required" += typ "NUMBER" += explicit += name "start-block"
         , endBlock := error "--end-block required" += typ "NUMBER" += explicit += name "end-block"
         , peer := 0x0 += typ "ETHEREUM_ADDRESS" += explicit += name "peer"
         ]

pushOptions :: Annotate Ann
pushOptions =
  record PushBlocks{startBlock=error "unused start block", endBlock=error "unused end block", peer = 0x0}
         [ startBlock := error "--start-block required" += typ "NUMBER" += explicit += name "start-block"
         , endBlock := error "--end-block required" += typ "NUMBER" += explicit += name "end-block"
         , peer := 0x0 += typ "ETHEREUM_ADDRESS" += explicit += name "peer"
         ]

options::Annotate Ann
options = modes_ [blockGoOptions
                , blockOptions
                , canonRedisOptions
                , checkpointOptions
                , codeOptions
                , dumpKafkaBlocksOptions
                , dumpKafkaRawOptions
                , dumpKafkaSequencerOptions
                , dumpKafkaSequencerVmOptions
                , dumpKafkaSequencerP2pOptions
                , dumpKafkaStateDiffOptions
                , dumpKafkaUnSequencerOptions
                , dumpKafkaUnminedBlocksOptions
                , fRawMPOptions
                , hashOptions
                , insertTXOptions
                , psqlOptions
                , rawMPOptions
                , rawOptions
                , redisOptions
                , rlpOptions
                , stateOptions
                , askOptions
                , pushOptions
                ]

--      += summary "Apply shims, reorganize, and generate to the input"

main::IO ()
main = do
  opts <- cmdArgs_ options
  run opts

-------------------

run::Options->IO ()
run State{..}                  = let sr = MP.StateRoot $ fst $ B16.decode $ BC.pack root in State.doit db sr
run DumpRedis{..}              = dumpRedis databaseNumber
run CanonRedis{..}             = canonRedis ipAddress start range
run Block{..}                  = Block.doit db hash
run BlockGO{..}                = BlockGO.doit hash
run Hash{..}                   = Hash.doit db hash
run Code{..}                   = Code.doit db hash
run Raw{..}                    = Raw.doit filename
run RLP{..}                    = RLP.doit filename
run RawMP{..}                  = RawMP.doit filename (MP.StateRoot . fst . B16.decode $ BC.pack stateRoot)
run FRawMP{..}                 = FRawMP.doit filename (MP.StateRoot . fst . B16.decode $ BC.pack stateRoot)
run DumpKafkaSequencer{..}     = dumpKafkaSequencer (fromIntegral startingBlock)
run DumpKafkaSequencerVM{..}   = dumpKafkaSequencerVM (fromIntegral startingBlock)
run DumpKafkaSequencerP2P{..}  = dumpKafkaSequencerP2P (fromIntegral startingBlock)
run DumpKafkaUnSequencer{..}   = dumpKafkaUnSequencer (fromIntegral startingBlock)
run DumpKafkaBlocks{..}        = dumpKafkaBlocks (fromIntegral startingBlock)
run DumpKafkaUnminedBlocks{..} = dumpKafkaUnminedBlocks (fromIntegral startingBlock)
run DumpKafkaRaw{..}           = dumpKafkaRaw streamName (fromIntegral startingBlock)
run DumpKafkaStateDiff{..}     = dumpKafkaStateDiff $ fromIntegral startingBlock
run Psql{}                     = psql
run InsertTX{}                 = insertTX
run Checkpoints{..}            = case operation of
      Get           -> doCheckpointGet service
      Put           -> doCheckpointPut service (fromIntegral <$> offset) cp
      NullOperation -> doCheckpointUsage
run AskForBlocks{..}           = insertP2P (OEAskForBlocks startBlock endBlock peer)
run PushBlocks{..}             = insertP2P (OEPushBlocks startBlock endBlock peer)
