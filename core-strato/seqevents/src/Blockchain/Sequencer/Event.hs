{-# LANGUAGE DeriveGeneric         #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE LambdaCase            #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TemplateHaskell       #-}
module Blockchain.Sequencer.Event where

import           Control.DeepSeq
import           Data.Binary
import           Data.List                                 (intercalate)
import           Data.Maybe                                (fromJust)
import           Data.DeriveTH
import           Test.QuickCheck

import qualified Blockchain.Data.Address                   as A
import           Blockchain.Data.Block                     (Block)
import qualified Blockchain.Data.BlockDB                   as BDB
import qualified Blockchain.Data.DataDefs                  as DD
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.RLP
import qualified Blockchain.Data.Transaction               as TX
import qualified Blockchain.Data.TXOrigin                  as TO
import           Blockchain.ExtWord                        (Word256)

import qualified GHC.Generics                              as GHCG

import qualified Blockchain.Colors                         as CL
import           Blockchain.Format

import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.SHA               (SHA (..))
import           Blockchain.Util

import qualified Blockchain.Blockstanbul                   as PBFT
import qualified Blockchain.Blockstanbul.HTTPAdmin         as PBFT

import           Blockchain.Sequencer.DB.Witnessable
import qualified Data.ByteString                           as BS
import qualified Data.ByteString.Lazy                      as B

import           Blockchain.Sequencer.BinaryInstances      ()

data SeqLoopEvent = TimerFire PBFT.RoundNumber
                  | VoteMade PBFT.CandidateReceived
                  | UnseqEvent IngestEvent
                  | WaitTerminated
                  deriving (Eq, Show, GHCG.Generic)

data IngestEvent = IETx Timestamp IngestTx
                 | IEBlock IngestBlock
                 | IEGenesis IngestGenesis
                 | IEBlockstanbul PBFT.WireMessage
                 deriving (Eq, Show, GHCG.Generic)

data IngestEventType = IETTransaction
                     | IETBlock
                     | IETGenesis
                     | IETBlockstanbul
                     deriving (Eq, Ord, Show)

iEventType :: IngestEvent -> IngestEventType
iEventType = \case
  IETx _ _    -> IETTransaction
  IEBlock _   -> IETBlock
  IEGenesis _ -> IETGenesis
  IEBlockstanbul _ -> IETBlockstanbul

instance Format IngestEvent where
  format (IETx ts o) = show ts ++ " " ++ format o
  format (IEBlock o) = format o
  format (IEGenesis o) = show o
  format (IEBlockstanbul o) = format o

type Timestamp = Microtime

data IngestTx = IngestTx { itOrigin      :: TO.TXOrigin
                         , itTransaction :: TX.Transaction
                         } deriving (Eq, Read, Show, GHCG.Generic)

data IngestBlock = IngestBlock { ibOrigin              :: TO.TXOrigin
                               , ibBlockData           :: DD.BlockData
                               , ibReceiptTransactions :: [TX.Transaction]
                               , ibBlockUncles         :: [DD.BlockData]
                               } deriving (Eq, Read, Show, GHCG.Generic)

data IngestGenesis = IngestGenesis { igOrigin          :: TO.TXOrigin
                                   , igGenesisInfo     :: (Word256, ChainInfo)
                                   } deriving (Eq, Show, GHCG.Generic)

data SequencedBlock = SequencedBlock { sbOrigin              :: TO.TXOrigin
                                     , sbHash                :: SHA
                                     , sbBlockData           :: DD.BlockData
                                     , sbReceiptTransactions :: [OutputTx]
                                     , sbBlockUncles         :: [DD.BlockData]
                                     } deriving (Read, Show, GHCG.Generic)

data JsonRpcCommand
    = JRCGetBalance { jrcAddress :: A.Address, jrcId :: String, jrcBlockString :: String}
    | JRCGetCode { jrcAddress :: A.Address, jrcId :: String, jrcBlockString :: String }
    | JRCGetTransactionCount { jrcAddress :: A.Address, jrcId :: String, jrcBlockString :: String }
    | JRCGetStorageAt { jrcAddress :: A.Address, jrcKey :: BS.ByteString, jrcId :: String, jrcBlockString :: String }
    | JRCCall { jrcCode :: BS.ByteString, jrcId :: String, jrcBlockString :: String}
    deriving (Eq, Read, Show, GHCG.Generic)

data OutputEvent = OETx Timestamp OutputTx
                 | OEBlock OutputBlock
                 | OEGenesis OutputGenesis
                 | OEJsonRpcCommand JsonRpcCommand
                 | OEGetChain [Word256]
                 | OEGetTx [SHA]
                 | OEBlockstanbul PBFT.WireMessage
                 | OECreateBlockCommand
                 -- Ask and push for inclusive ranges of blocks
                 | OEAskForBlocks {askStart :: Integer, askEnd :: Integer, askPeer :: A.Address}
                 | OEPushBlocks {pushStart :: Integer, pushEnd :: Integer, pushPeer :: A.Address}
                 deriving (Eq, Show, GHCG.Generic)

instance Format OutputEvent where
  format (OETx ts o)       = show ts ++ " " ++ format o
  format (OEBlock o)       = format o
  format (OEGenesis o)     = show o
  format (OEGetChain cids) = "[" ++ (intercalate "," $ map (format . SHA) cids) ++ "]"
  format (OEGetTx shas)    = "[" ++ (intercalate "," $ map format shas) ++ "]"
  format x                 = show x

data OutputTx = OutputTx { otOrigin :: TO.TXOrigin
                         , otHash   :: SHA
                         , otSigner :: A.Address
                         , otBaseTx :: TX.Transaction
                         } deriving (Eq, Read, Show, GHCG.Generic)
instance NFData OutputTx

data OutputBlock = OutputBlock { obOrigin              :: TO.TXOrigin
                               , obTotalDifficulty     :: Integer
                               , obBlockData           :: DD.BlockData
                               , obReceiptTransactions :: [OutputTx]
                               , obBlockUncles         :: [DD.BlockData]
                               } deriving (Eq, Read, Show, GHCG.Generic)

data OutputGenesis = OutputGenesis { ogOrigin          :: TO.TXOrigin
                                   , ogGenesisInfo     :: (Word256, ChainInfo)
                                   } deriving (Eq, Show, GHCG.Generic)

ingestGenesisToOutputGenesis :: IngestGenesis -> OutputGenesis
ingestGenesisToOutputGenesis (IngestGenesis o g) = OutputGenesis o g

blockToIngestBlock :: TO.TXOrigin -> Block -> IngestBlock
blockToIngestBlock origin BDB.Block{BDB.blockBlockData=bd,BDB.blockReceiptTransactions=txs,BDB.blockBlockUncles=us} =
    IngestBlock{ibOrigin = origin, ibBlockData = bd, ibReceiptTransactions = txs, ibBlockUncles = us}

ingestBlockToBlock :: IngestBlock -> BDB.Block
ingestBlockToBlock IngestBlock{ibBlockData=bd, ibReceiptTransactions = txs, ibBlockUncles = us} =
    BDB.Block{BDB.blockBlockData = bd, BDB.blockReceiptTransactions = txs, BDB.blockBlockUncles = us}

ingestBlockToSequencedBlock :: IngestBlock -> Maybe SequencedBlock
ingestBlockToSequencedBlock ib =
    let theHash = (BDB.blockHeaderHash . ibBlockData $ ib)
            in case sequence $ wrapIngestBlockTransaction theHash <$> ibReceiptTransactions ib of
                Nothing -> Nothing
                Just outputTxs -> Just SequencedBlock { sbOrigin              = ibOrigin ib
                                                      , sbHash                = theHash
                                                      , sbBlockData           = ibBlockData ib
                                                      , sbReceiptTransactions = outputTxs
                                                      , sbBlockUncles         = ibBlockUncles ib
                                                      }

sequencedBlockToOutputBlock :: SequencedBlock -> Integer -> OutputBlock
sequencedBlockToOutputBlock sb totalDifficulty = OutputBlock { obOrigin              = sbOrigin sb
                                                             , obTotalDifficulty     = totalDifficulty
                                                             , obBlockData           = sbBlockData sb
                                                             , obReceiptTransactions = sbReceiptTransactions sb
                                                             , obBlockUncles         = sbBlockUncles sb
                                                             }

sequencedBlockToBlock :: SequencedBlock -> Block
sequencedBlockToBlock sb = BDB.Block
                         { BDB.blockBlockData = sbBlockData sb
                         , BDB.blockReceiptTransactions = map otBaseTx $ sbReceiptTransactions sb
                         , BDB.blockBlockUncles = sbBlockUncles sb
                         }

sequencedBlockShortName :: SequencedBlock -> String
sequencedBlockShortName SequencedBlock{sbBlockData=d, sbHash=theHash} =
    "Block #" ++ CL.yellow(show . DD.blockDataNumber $ d) ++ "/" ++ CL.blue(format theHash)

wrapTransaction :: IngestTx -> Maybe OutputTx
wrapTransaction tx@IngestTx{} =
    let baseTx = itTransaction tx in case TX.whoSignedThisTransaction baseTx of
            Nothing -> Nothing
            Just signer -> Just OutputTx { otOrigin = itOrigin tx
                                         , otHash   = TX.transactionHash baseTx
                                         , otSigner = signer
                                         , otBaseTx = baseTx
                                         }

wrapIngestBlockTransaction :: SHA -> TX.Transaction -> Maybe OutputTx
wrapIngestBlockTransaction hash tx =
    case TX.whoSignedThisTransaction tx of
        Nothing -> Nothing
        Just signer -> Just OutputTx { otOrigin = TO.BlockHash hash
                                     , otSigner = signer
                                     , otBaseTx = tx
                                     , otHash   = TX.transactionHash tx
                                     }

parentHashBS :: SequencedBlock -> BS.ByteString
parentHashBS = B.toStrict . encode . DD.blockDataParentHash . sbBlockData

ingestBlockHash :: IngestBlock -> SHA
ingestBlockHash = BDB.blockHeaderHash . ibBlockData

ingestBlockHashBS :: IngestBlock -> BS.ByteString
ingestBlockHashBS = B.toStrict . encode . ingestBlockHash

ingestBlockDifficulty :: IngestBlock -> Integer
ingestBlockDifficulty = DD.blockDataDifficulty . ibBlockData

blockHashBS :: SequencedBlock -> BS.ByteString
blockHashBS = B.toStrict . encode . sbHash

sequencedBlockDifficulty :: SequencedBlock -> Integer
sequencedBlockDifficulty = DD.blockDataDifficulty . sbBlockData

outputBlockHash :: OutputBlock -> SHA
outputBlockHash = BDB.blockHeaderHash . obBlockData

outputBlockToBlock :: OutputBlock -> Block
outputBlockToBlock OutputBlock{obBlockData=bd,obReceiptTransactions=txs,obBlockUncles=us}=
    BDB.Block{BDB.blockBlockData = bd, BDB.blockReceiptTransactions=otBaseTx <$> txs, BDB.blockBlockUncles=us}

quarryBlockToOutputBlock :: BDB.Block -> OutputBlock
quarryBlockToOutputBlock BDB.Block{BDB.blockBlockData=bd,BDB.blockReceiptTransactions=txs,BDB.blockBlockUncles=us} =
    OutputBlock { obOrigin              = TO.Quarry
                , obBlockData           = bd
                , obBlockUncles         = us
                , obReceiptTransactions = wrapQuarryReceipt <$> txs
                , obTotalDifficulty     = 0
                }

    where wrapQuarryReceipt t = OutputTx { otOrigin = TO.Quarry
                                         , otBaseTx = t
                                         , otSigner = fromJust . TX.whoSignedThisTransaction $ t
                                         , otHash   = TX.transactionHash t
                                         }

instance Witnessable IngestTx where
    witnessableHash = TX.partialTransactionHash . itTransaction

instance Witnessable OutputTx where
    witnessableHash = otHash

instance Witnessable SequencedBlock where
    witnessableHash = blockHeaderHash . sbBlockData

instance Eq SequencedBlock where
    a == b = sbHash a == sbHash b

instance Ord OutputTx where
    compare OutputTx{otHash = hA} OutputTx{otHash = hB} = compare hA hB

instance Binary IngestTx where
instance Binary IngestBlock where
instance Binary IngestGenesis where
instance Binary SequencedBlock where
instance Binary OutputTx where
instance Binary OutputBlock where
instance Binary OutputGenesis where

instance Binary IngestEvent where
    -- put (IETx t)    = putWord8 0 >> put t -- legacy IETx
    put (IETx ts t) = putWord8 2 >> put ts >> put t
    put (IEBlock b) = putWord8 1 >> put b
    put (IEGenesis g) = putWord8 3 >> put g
    put (IEBlockstanbul m) = putWord8 4 >> put m
    get = do
        tag <- getWord8
        case tag of
            0 -> IETx 0 <$> get -- legacy IETx
            1 -> IEBlock  <$> get
            2 -> IETx <$> get <*> get
            3 -> IEGenesis <$> get
            4 -> IEBlockstanbul <$> get
            x -> error $ "unknown InputEvent tag " ++ show x

instance Binary JsonRpcCommand where
  put JRCGetBalance{jrcAddress=a, jrcId=i, jrcBlockString=b} =
    putWord8 0 >> put a >> put i >> put b
  put JRCGetCode{jrcAddress=a, jrcId=i, jrcBlockString=b} =
    putWord8 1 >> put a >> put i >> put b
  put JRCGetTransactionCount {jrcAddress=a, jrcId=i, jrcBlockString=b} =
    putWord8 2 >> put a >> put i >> put b
  put JRCGetStorageAt {jrcAddress=a, jrcKey=k, jrcId=i, jrcBlockString=b} =
    putWord8 3 >> put a >> put k >> put i >> put b
  put JRCCall{jrcCode=c,jrcId=i,jrcBlockString=b} =
    putWord8 4 >> put c >> put i >> put b
  get = do
        tag <- getWord8
        case tag of
            0 -> JRCGetBalance <$> get <*> get <*> get
            1 -> JRCGetCode <$> get <*> get <*> get
            2 -> JRCGetTransactionCount <$> get <*> get <*> get
            3 -> JRCGetStorageAt <$> get <*> get <*> get <*> get
            4 -> JRCCall <$> get <*> get <*> get
            x -> error $ "unknown JsonRpcCommand tag " ++ show x

instance Binary OutputEvent where
    -- Reserved tags: 0, 9, 10
    put (OETx ts t)          = putWord8 3 >> put ts >> put t
    put (OEBlock b)          = putWord8 1 >> put b
    put (OEJsonRpcCommand c) = putWord8 2 >> put c
    put (OEGenesis g)        = putWord8 4 >> put g
    put (OEGetChain cid)     = putWord8 5 >> put cid
    put (OEGetTx tx)         = putWord8 6 >> put tx
    put (OEBlockstanbul m)   = putWord8 7 >> put m
    put (OECreateBlockCommand) = putWord8 8
    put (OEAskForBlocks s e p) = putWord8 11 >> put s >> put e >> put p
    put (OEPushBlocks s e p) = putWord8 12 >> put s >> put e >> put p
    get = do
        tag <- getWord8
        case tag of
            0 -> OETx 0 <$> get -- legacy OETx
            1 -> OEBlock <$> get
            2 -> OEJsonRpcCommand <$> get
            3 -> OETx <$> get <*> get
            4 -> OEGenesis <$> get
            5 -> OEGetChain <$> get
            6 -> OEGetTx <$> get
            7 -> OEBlockstanbul <$> get
            8 -> pure OECreateBlockCommand
            9 -> OEAskForBlocks <$> get <*> get <*> pure 0x0 -- legacy OEAFB
            10 -> OEPushBlocks <$> get <*> get <*> pure 0x0 -- legacy OEPB
            11 -> OEAskForBlocks <$> get <*> get <*> get
            12 -> OEPushBlocks <$> get <*> get <*> get
            x -> error $ "unknown OutputEvent tag " ++ show x

instance Format IngestBlock where
    format b@IngestBlock { ibOrigin              = origin
                         , ibBlockData           = bd
                         , ibReceiptTransactions = receipts
                         , ibBlockUncles         = uncles
                         } =
        CL.blue ("Block #" ++ show (BDB.blockDataNumber bd)) ++ " (via " ++ format origin ++ ") " ++
        tab (format (ingestBlockHash b) ++ "\n" ++
             format bd ++
             (if null receipts
              then "        (no transactions)\n"
              else tab (intercalate "\n    " (format <$> receipts))) ++
             (if null uncles
              then "        (no uncles)"
              else tab ("Uncles:" ++ tab ("\n" ++ intercalate "\n    " (format <$> uncles)))))

instance Format OutputBlock where
    format b@OutputBlock { obOrigin              = origin
                         , obTotalDifficulty     = totDiff
                         , obBlockData           = bd
                         , obReceiptTransactions = receipts
                         , obBlockUncles         = uncles
                         } =
        CL.blue ("OutputBlock #" ++ show (BDB.blockDataNumber bd) ++ "; total diff " ++ show totDiff) ++ " (via " ++ format origin ++ ") " ++
        tab (format (outputBlockHash b) ++ "\n" ++
             format bd ++
             (if null receipts
              then "        (no transactions)\n"
              else tab (intercalate "\n    " (format <$> receipts))) ++
             (if null uncles
              then "        (no uncles)"
              else tab ("Uncles:" ++ tab ("\n" ++ intercalate "\n    " (format <$> uncles)))))

instance Format OutputTx where
    format OutputTx{ otOrigin = origin
                   , otSigner = signer
                   , otBaseTx = base
                   } =
           CL.red("OutputTx from address " ++ format signer)
                ++ tab (" via " ++ format origin ++ "\n" ++ format base)

instance Format IngestTx where
    format IngestTx{ itOrigin      = origin
                   , itTransaction = base
                   } =
           CL.red("IngestTx via " ++ format origin ++ "\n" ++ tab (format base))

-- todo: can we get away with this? seems like there'd be overhead recomputing
-- todo: otSigner
instance RLPSerializable OutputTx where
    rlpEncode = rlpEncode . otBaseTx
    rlpDecode = morphTx . (rlpDecode :: RLPObject -> TX.Transaction)

instance TransactionLike OutputTx where
    txHash        = otHash
    txPartialHash = txPartialHash . otBaseTx
    txChainHash   = txChainHash . otBaseTx
    txSigner      = Just . otSigner
    txNonce       = txNonce . otBaseTx
    txType        = txType . otBaseTx
    txSignature   = txSignature . otBaseTx
    txValue       = txValue . otBaseTx
    txDestination = txDestination . otBaseTx
    txGasPrice    = txGasPrice . otBaseTx
    txGasLimit    = txGasLimit . otBaseTx
    txCode        = txCode . otBaseTx
    txData        = txData . otBaseTx
    txChainId     = txChainId . otBaseTx
    txMetadata    = txMetadata . otBaseTx

    morphTx t = OutputTx { otOrigin = TO.Direct -- todo: introduce a "morph" conversion?
                         , otHash   = txHash t
                         , otSigner = fromJust (txSigner t) -- todo: D A N G E R
                         , otBaseTx = morphTx t
                         }

instance RLPSerializable OutputBlock where
    rlpEncode = rlpEncode . (morphBlock :: OutputBlock -> Block)
    rlpDecode = morphBlock . (rlpDecode :: RLPObject -> Block)

instance BlockLike DD.BlockData OutputTx OutputBlock where
    blockHeader       = obBlockData
    blockTransactions = obReceiptTransactions
    blockUncleHeaders = obBlockUncles

    blockOrdering = obTotalDifficulty
    buildBlock = OutputBlock TO.Morphism 0

derive makeArbitrary ''IngestEvent
derive makeArbitrary ''IngestTx
derive makeArbitrary ''IngestBlock
derive makeArbitrary ''IngestGenesis
derive makeArbitrary ''SequencedBlock
derive makeArbitrary ''OutputEvent
derive makeArbitrary ''OutputTx
derive makeArbitrary ''OutputBlock
derive makeArbitrary ''OutputGenesis

-- just end me fam
instance Arbitrary JsonRpcCommand where
   arbitrary = JRCGetBalance <$> arbitrary <*> arbitrary <*> arbitrary
