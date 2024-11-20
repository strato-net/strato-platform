{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Sequencer.Event where

import qualified Blockchain.Blockstanbul as PBFT
import qualified Blockchain.Data.Block as BDB
import Blockchain.Data.BlockHeader
import Blockchain.Data.ChainInfo
import Blockchain.Data.Json
import Blockchain.Data.RLP
import qualified Blockchain.Data.TXOrigin as TO
import qualified Blockchain.Data.Transaction as TX
import Blockchain.Database.MerklePatricia.NodeData (NodeData)
import Blockchain.Sequencer.BinaryInstances ()
import Blockchain.Sequencer.DB.Witnessable
import qualified Blockchain.Strato.Model.Address as A
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.ExtendedWord (Word256)
import Blockchain.Strato.Model.Keccak256 (Keccak256)
import Blockchain.Strato.Model.MicroTime
import Blockchain.Strato.Model.StateRoot
import Blockchain.Strato.Model.Address
import Control.DeepSeq
import Control.Lens
import Data.Aeson hiding (encode)
import Data.Binary
import qualified Data.ByteString as BS
import qualified Data.ByteString.Lazy as B
import Data.Data
import Data.List (intercalate)
import Data.Maybe (fromJust, fromMaybe)
import qualified GHC.Generics as GHCG
import Test.QuickCheck
import Test.QuickCheck.Arbitrary.Generic
import qualified Text.Colors as CL
import Text.Format
import Text.Tools

data SeqLoopEvent
  = TimerFire PBFT.RoundNumber
  | UnseqEvents [IngestEvent]
  deriving (Eq, Show, GHCG.Generic)

instance Format SeqLoopEvent where
  format (TimerFire rn) = "TimerFire " ++ format rn
  format (UnseqEvents ev) = "UnseqEvents " ++ format ev

class ShowConstructor a where
  showConstructor :: a -> String

data IngestEvent
  = IETx Timestamp IngestTx
  | IEBlock IngestBlock
  | IEBlockstanbul PBFT.WireMessage
  | IEForcedConfigChange PBFT.ForcedConfigChange
  | IEValidatorBehavior PBFT.ForcedValidatorChange
  | IEDeleteDepBlock Keccak256
  | IEGetMPNodes [StateRoot]
  | IEGetMPNodesRequest TO.TXOrigin [StateRoot]
  | IEMPNodesResponse TO.TXOrigin [NodeData]
  | IEMPNodesReceived [NodeData]
  | IEPreprepareResponse PBFT.PreprepareDecision
  deriving (Eq, Show, GHCG.Generic)

data IngestEventType
  = IETTransaction
  | IETBlock
  | IETPreprepareResponse
  | IETBlockstanbul
  | IETForcedConfigChange
  | IETValidatorBehavior
  | IETDeleteDepBlock
  | IETGetMPNodes
  | IETGetMPNodesRequest
  | IETMPNodesResponse
  | IETMPNodesReceived
  deriving (Eq, Ord, Show)

iEventType :: IngestEvent -> IngestEventType
iEventType = \case
  IETx {} -> IETTransaction
  IEBlock {} -> IETBlock
  IEBlockstanbul {} -> IETBlockstanbul
  IEForcedConfigChange {} -> IETForcedConfigChange
  IEValidatorBehavior {} -> IETValidatorBehavior
  IEDeleteDepBlock {} -> IETDeleteDepBlock
  IEGetMPNodes {} -> IETGetMPNodes
  IEGetMPNodesRequest {} -> IETGetMPNodesRequest
  IEMPNodesResponse {} -> IETMPNodesResponse
  IEMPNodesReceived {} -> IETMPNodesReceived
  IEPreprepareResponse {} -> IETPreprepareResponse

instance Format IngestEvent where
  format (IETx ts o) = show ts ++ " " ++ format o
  format (IEBlock o) = format o
  format (IEBlockstanbul o) = format o
  format (IEForcedConfigChange o) = format o
  format (IEValidatorBehavior o) = show o
  format (IEDeleteDepBlock o) = show o
  format (IEGetMPNodes o) = format o
  format (IEGetMPNodesRequest o s) = format o ++ "requested: " ++ format s
  format (IEMPNodesResponse o n) = "Response to " ++ format o ++ ": " ++ show n
  format (IEMPNodesReceived o) = show o
  format (IEPreprepareResponse d) = format d

instance ShowConstructor IngestEvent where
  showConstructor IETx{} = "IETx"
  showConstructor IEBlock{} = "IEBlock"
  showConstructor IEBlockstanbul{} = "IEBlockstanbul"
  showConstructor IEForcedConfigChange{} = "IEForcedConfigChange"
  showConstructor IEValidatorBehavior{} = "IEValidatorBehavior"
  showConstructor IEDeleteDepBlock{} = "IEDeleteDepBlock"
  showConstructor IEGetMPNodes{} = "IEGetMPNodes"
  showConstructor IEGetMPNodesRequest{} = "IEGetMPNodesRequest"
  showConstructor IEMPNodesResponse{} = "IEMPNodesResponse"
  showConstructor IEMPNodesReceived{} = "IEMPNodesReceived"
  showConstructor IEPreprepareResponse{} = "IEPreprepareResponse"

type Timestamp = Microtime

data IngestTx = IngestTx
  { itOrigin :: TO.TXOrigin,
    itTransaction :: TX.Transaction
  }
  deriving (Eq, Read, Show, GHCG.Generic)

data IngestBlock = IngestBlock
  { ibOrigin :: TO.TXOrigin,
    ibBlockData :: BlockHeader,
    ibReceiptTransactions :: [TX.Transaction],
    ibBlockUncles :: [BlockHeader]
  }
  deriving (Eq, Show, GHCG.Generic)

data IngestGenesis = IngestGenesis
  { igOrigin :: TO.TXOrigin,
    igGenesisInfo :: (Word256, ChainInfo)
  }
  deriving (Eq, Show, GHCG.Generic, Data)

data SequencedBlock = SequencedBlock
  { sbOrigin :: TO.TXOrigin,
    sbHash :: Keccak256,
    sbBlockData :: BlockHeader,
    sbReceiptTransactions :: [OutputTx],
    sbBlockUncles :: [BlockHeader]
  }
  deriving (Show, GHCG.Generic)

data JsonRpcCommand
  = JRCGetBalance {jrcAddress :: A.Address, jrcId :: String, jrcBlockString :: String}
  | JRCGetCode {jrcAddress :: A.Address, jrcId :: String, jrcBlockString :: String}
  | JRCGetTransactionCount {jrcAddress :: A.Address, jrcId :: String, jrcBlockString :: String}
  | JRCGetStorageAt {jrcAddress :: A.Address, jrcKey :: BS.ByteString, jrcId :: String, jrcBlockString :: String}
  | JRCCall {jrcCode :: BS.ByteString, jrcId :: String, jrcBlockString :: String}
  deriving (Eq, Read, Show, GHCG.Generic, Data)

data P2pEvent
  = P2pTx OutputTx
  | P2pBlock OutputBlock
  | P2pGenesis OutputGenesis
  | P2pGetChain [Word256]
  | P2pGetTx [Keccak256]
  | P2pNewOrgName Word256 ChainMemberParsedSet
  | P2pBlockstanbul PBFT.WireMessage
  | -- Ask and push for inclusive ranges of blocks
    P2pAskForBlocks {askStart :: Integer, askEnd :: Integer, askPeer :: ChainMemberParsedSet}
  | P2pPushBlocks {pushStart :: Integer, pushEnd :: Integer, pushPeer :: ChainMemberParsedSet}
  | P2pGetMPNodes [StateRoot]
  | P2pMPNodesResponse TO.TXOrigin [NodeData]
  deriving (Eq, Show, GHCG.Generic)

instance Format P2pEvent where
  format (P2pTx o) = format o
  format (P2pBlock o) = format o
  format (P2pGenesis o) = show o
  format (P2pGetChain cids) = "[" ++ (intercalate "," $ map (CL.yellow . format) cids) ++ "]"
  format (P2pGetTx shas) = "[" ++ (intercalate "," $ map format shas) ++ "]"
  format (P2pNewOrgName c cm) = intercalate ", " [CL.yellow $ format c, show cm]
  format (P2pBlockstanbul o) = format o
  format (P2pGetMPNodes srs) = "[" ++ (intercalate "," $ map format srs) ++ "]"
  format (P2pMPNodesResponse o nds) = "Response to " ++ show o ++ ": [" ++ (intercalate "," $ map show nds) ++ "]"
  format x = show x

instance ShowConstructor P2pEvent where
  showConstructor P2pTx{} = "P2pTx"
  showConstructor P2pBlock{} = "P2pBlock"
  showConstructor P2pGenesis{} = "P2pGenesis"
  showConstructor P2pGetChain{} = "P2pGetChain"
  showConstructor P2pGetTx{} = "P2pGetTx"
  showConstructor P2pNewOrgName{} = "P2pNewOrgName"
  showConstructor P2pBlockstanbul{} = "P2pBlockstanbul"
  showConstructor P2pAskForBlocks{} = "P2pAskForBlocks"
  showConstructor P2pPushBlocks{} = "P2pPushBlocks"
  showConstructor P2pGetMPNodes{} = "P2pGetMPNodes"
  showConstructor P2pMPNodesResponse{} = "P2pMPNodesResponse"

data VmEvent
  = VmTx Timestamp OutputTx
  | VmBlock OutputBlock
  | VmGenesis OutputGenesis
  | VmJsonRpcCommand JsonRpcCommand
  | VmCreateBlockCommand
  | VmPrivateTx OutputTx
  | VmGetMPNodesRequest TO.TXOrigin [StateRoot]
  | VmMPNodesReceived [NodeData]
  | VmRunPreprepare BDB.Block
  | VmSelfAddress Address
  deriving (Eq, Show, GHCG.Generic)

instance Format VmEvent where
  format (VmTx ts o) = show ts ++ " " ++ format o
  format (VmBlock o) = format o
  format (VmGenesis o) = show o
  format (VmGetMPNodesRequest o srs) = show o ++ " requested: " ++ format srs
  format (VmMPNodesReceived nds) = show nds
  format x = show x

instance ShowConstructor VmEvent where
  showConstructor VmTx{} = "VmTx"
  showConstructor VmBlock{} = "VmBlock"
  showConstructor VmGenesis{} = "VmGenesis"
  showConstructor VmJsonRpcCommand{} = "VmJsonRpcCommand"
  showConstructor VmCreateBlockCommand{} = "VmCreateBlockCommand"
  showConstructor VmPrivateTx{} = "VmPrivateTx"
  showConstructor VmGetMPNodesRequest{} = "VmGetMPNodesRequest"
  showConstructor VmMPNodesReceived{} = "VmMPNodesReceived"
  showConstructor VmRunPreprepare{} = "VmRunPreprepare"
  showConstructor VmSelfAddress{} = "VmSelfAddress"

data OutputTx = OutputTx
  { otOrigin :: TO.TXOrigin,
    otHash :: Keccak256,
    otSigner :: A.Address,
    otBaseTx :: TX.Transaction,
    otPrivatePayload :: Maybe TX.Transaction
  }
  deriving (Eq, Read, Show, GHCG.Generic, NFData, Data)

data OutputTx' = OutputTx'
  { ot'Origin :: TO.TXOrigin,
    ot'Hash :: Keccak256,
    ot'Signer :: A.Address,
    ot'BaseTx :: Transaction',
    ot'PrivatePayload :: Maybe Transaction'
  }
  deriving (Eq, Show, GHCG.Generic)

otxToOtxPrime :: OutputTx -> OutputTx'
otxToOtxPrime (OutputTx o h s b p) = (OutputTx' o h s (Transaction' b) (Transaction' <$> p))

otxPrimeToOtx :: OutputTx' -> OutputTx
otxPrimeToOtx (OutputTx' o h s b mp) = OutputTx o h s (unTransaction' b) (unTransaction' <$> mp)
  where
    unTransaction' (Transaction' t) = t

data OutputBlock = OutputBlock
  { obOrigin :: TO.TXOrigin,
    obBlockData :: BlockHeader,
    obReceiptTransactions :: [OutputTx],
    obBlockUncles :: [BlockHeader]
  }
  deriving (Eq, Show, GHCG.Generic)

data OutputBlock' = OutputBlock'
  { ob'Origin :: TO.TXOrigin,
    ob'BlockData :: BlockData',
    ob'ReceiptTransactions :: [OutputTx'],
    ob'BlockUncles :: [BlockData']
  }
  deriving (Eq, Show, GHCG.Generic)

obToObPrime :: OutputBlock -> OutputBlock'
obToObPrime (OutputBlock o bd rt bu) =
  OutputBlock'
    o
    (BlockData' bd)
    (otxToOtxPrime <$> rt)
    (BlockData' <$> bu)

obPrimeToOb :: OutputBlock' -> OutputBlock
obPrimeToOb (OutputBlock' o (BlockData' bd) rt bu) =
  OutputBlock
    o
    bd
    (otxPrimeToOtx <$> rt)
    ((\(BlockData' b) -> b) <$> bu)

data OutputGenesis = OutputGenesis
  { ogOrigin :: TO.TXOrigin,
    ogGenesisInfo :: (Word256, ChainInfo)
  }
  deriving (Eq, Show, GHCG.Generic, Data)

ingestGenesisToOutputGenesis :: IngestGenesis -> OutputGenesis
ingestGenesisToOutputGenesis (IngestGenesis o g) = OutputGenesis o g

blockToIngestBlock :: TO.TXOrigin -> BDB.Block -> IngestBlock
blockToIngestBlock origin BDB.Block {BDB.blockBlockData = bd, BDB.blockReceiptTransactions = txs, BDB.blockBlockUncles = us} =
  IngestBlock {ibOrigin = origin, ibBlockData = bd, ibReceiptTransactions = txs, ibBlockUncles = us}

ingestBlockToBlock :: IngestBlock -> BDB.Block
ingestBlockToBlock IngestBlock {ibBlockData = bd, ibReceiptTransactions = txs, ibBlockUncles = us} = BDB.Block bd txs us

ingestBlockToSequencedBlock :: IngestBlock -> Maybe SequencedBlock
ingestBlockToSequencedBlock ib = do
  let theHash = (blockHeaderHash . ibBlockData $ ib)
  otxs <- traverse (wrapIngestBlockTransaction theHash) $ ibReceiptTransactions ib
  Just
    SequencedBlock
      { sbOrigin = ibOrigin ib,
        sbHash = theHash,
        sbBlockData = ibBlockData ib,
        sbReceiptTransactions = otxs,
        sbBlockUncles = ibBlockUncles ib
      }

sequencedBlockToOutputBlock :: SequencedBlock -> OutputBlock
sequencedBlockToOutputBlock sb =
  OutputBlock
    { obOrigin = sbOrigin sb,
      obBlockData = sbBlockData sb,
      obReceiptTransactions = sbReceiptTransactions sb,
      obBlockUncles = sbBlockUncles sb
    }

sequencedBlockToBlock :: SequencedBlock -> BDB.Block
sequencedBlockToBlock sb = BDB.Block (sbBlockData sb) (map otBaseTx $ sbReceiptTransactions sb) (sbBlockUncles sb)

sequencedBlockShortName :: SequencedBlock -> String
sequencedBlockShortName SequencedBlock {sbBlockData = d, sbHash = theHash} =
  "Block #" ++ CL.yellow (show . number $ d) ++ "/" ++ CL.blue (format theHash)

wrapTransaction :: Monad m => IngestTx -> m (Maybe OutputTx)
wrapTransaction tx@IngestTx {} = do
  let baseTx = itTransaction tx
  case TX.whoSignedThisTransaction baseTx of
    Nothing -> return Nothing
    Just signer -> do
      return $
        Just
          OutputTx
            { otOrigin = itOrigin tx,
              otHash = TX.transactionHash baseTx,
              otSigner = signer,
              otBaseTx = baseTx,
              otPrivatePayload = Nothing
            }

wrapTransactionUnanchored :: IngestTx -> Maybe OutputTx
wrapTransactionUnanchored tx@IngestTx {} =
  let baseTx = itTransaction tx
   in case TX.whoSignedThisTransaction baseTx of
        Nothing -> Nothing
        Just signer ->
          Just
            OutputTx
              { otOrigin = itOrigin tx,
                otHash = TX.transactionHash baseTx,
                otSigner = signer,
                otBaseTx = baseTx,
                otPrivatePayload = Nothing
              }

wrapIngestBlockTransaction :: Keccak256 -> TX.Transaction -> Maybe OutputTx
wrapIngestBlockTransaction hash tx =
  case TX.whoSignedThisTransaction tx of
    Nothing -> Nothing
    Just signer ->
      Just
        OutputTx
          { otOrigin = TO.BlockHash hash,
            otSigner = signer,
            otBaseTx = tx,
            otHash = TX.transactionHash tx,
            otPrivatePayload = Nothing
          }

wrapIngestBlockTransactionUnanchored :: Keccak256 -> TX.Transaction -> Maybe OutputTx
wrapIngestBlockTransactionUnanchored hash tx =
  case TX.whoSignedThisTransaction tx of
    Nothing -> Nothing
    Just signer ->
      Just
        OutputTx
          { otOrigin = TO.BlockHash hash,
            otSigner = signer,
            otBaseTx = tx,
            otHash = TX.transactionHash tx,
            otPrivatePayload = Nothing
          }

parentHashBS :: SequencedBlock -> BS.ByteString
parentHashBS = B.toStrict . encode . parentHash . sbBlockData

ingestBlockHash :: IngestBlock -> Keccak256
ingestBlockHash = blockHeaderHash . ibBlockData

ingestBlockHashBS :: IngestBlock -> BS.ByteString
ingestBlockHashBS = B.toStrict . encode . ingestBlockHash

ingestBlockDifficulty :: IngestBlock -> Integer
ingestBlockDifficulty = difficulty . ibBlockData

blockHashBS :: SequencedBlock -> BS.ByteString
blockHashBS = B.toStrict . encode . sbHash

sequencedBlockDifficulty :: SequencedBlock -> Integer
sequencedBlockDifficulty = getBlockDifficulty . sbBlockData

outputBlockHash :: OutputBlock -> Keccak256
outputBlockHash = blockHeaderHash . obBlockData

outputBlockToBlock :: OutputBlock -> BDB.Block
outputBlockToBlock OutputBlock {obBlockData = bd, obReceiptTransactions = txs, obBlockUncles = us} = BDB.Block bd (otBaseTx <$> txs) us

outputBlockToBlockRetainPayloads :: OutputBlock -> BDB.Block
outputBlockToBlockRetainPayloads OutputBlock {obBlockData = bd, obReceiptTransactions = txs, obBlockUncles = us} =
  let payload t = fromMaybe (otBaseTx t) (otPrivatePayload t)
   in BDB.Block bd (payload <$> txs) us

quarryBlockToOutputBlock :: Monad m => BDB.Block -> m OutputBlock
quarryBlockToOutputBlock BDB.Block {BDB.blockBlockData = bd, BDB.blockReceiptTransactions = txs, BDB.blockBlockUncles = us} = do
  rtxs <- mapM wrapQuarryReceipt txs
  return
    OutputBlock
      { obOrigin = TO.Quarry,
        obBlockData = bd,
        obBlockUncles = us,
        obReceiptTransactions = rtxs
      }
  where
    wrapQuarryReceipt t = do
      return
        OutputTx
          { otOrigin = TO.Quarry,
            otBaseTx = t,
            otSigner = fromJust . TX.whoSignedThisTransaction $ t,
            otHash = TX.transactionHash t,
            otPrivatePayload = Nothing
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
  compare OutputTx {otHash = hA} OutputTx {otHash = hB} = compare hA hB

instance Binary IngestTx

instance Binary IngestBlock

instance Binary IngestGenesis

instance Binary SequencedBlock

instance Binary OutputTx

instance Binary OutputBlock

instance Binary OutputGenesis

instance Binary IngestEvent

instance Binary JsonRpcCommand

instance Binary P2pEvent

instance Binary VmEvent

instance Format IngestBlock where
  format
    b@IngestBlock
      { ibOrigin = origin,
        ibBlockData = bd,
        ibReceiptTransactions = receipts,
        ibBlockUncles = uncles
      } =
      CL.blue ("Block #" ++ show (number bd)) ++ " (via " ++ format origin ++ ") "
        ++ tab'
          ( format (ingestBlockHash b) ++ "\n"
              ++ format bd
              ++ ( if null receipts
                     then "        (no transactions)\n"
                     else tab' (show $ length receipts)
                 )
              ++ ( if null uncles
                     then "        (no uncles)"
                     else tab' (show $ length uncles)
                 )
          )

instance Format OutputBlock where
  format
    b@OutputBlock
      { obOrigin = origin,
        obBlockData = bd,
        obReceiptTransactions = receipts,
        obBlockUncles = uncles
      } =
      CL.blue ("OutputBlock #" ++ show (number bd) ++ ";") ++ " (via " ++ format origin ++ ") "
        ++ tab'
          ( format (outputBlockHash b) ++ "\n"
              ++ format bd
              ++ ( if null receipts
                     then "        (no transactions)\n"
                     else tab' (show $ length receipts)
                 )
              ++ ( if null uncles
                     then "        (no uncles)"
                     else tab' (show $ length uncles)
                 )
          )

instance Format OutputTx where
  format
    OutputTx
      { otOrigin = origin,
        otSigner = signer,
        otBaseTx = base
      } =
      CL.red ("OutputTx from address " ++ format signer)
        ++ tab' (" via " ++ format origin ++ "\n" ++ format (txHash base))

instance Format IngestTx where
  format
    IngestTx
      { itOrigin = origin,
        itTransaction = base
      } =
      CL.red ("IngestTx via " ++ format origin ++ "\n" ++ tab' (format $ txHash base))

-- todo: can we get away with this? seems like there'd be overhead recomputing
-- todo: otSigner
instance RLPSerializable OutputTx where
  rlpEncode = rlpEncode . otBaseTx
  rlpDecode = morphTx . (rlpDecode :: RLPObject -> TX.Transaction)

instance TransactionLike OutputTx where
  txHash = otHash
  txPartialHash = txPartialHash . otBaseTx
  txChainHash = txChainHash . otBaseTx
  txSigner = Just . otSigner
  txNonce = txNonce . otBaseTx
  txType = txType . otBaseTx
  txSignature = txSignature . otBaseTx
  txValue = txValue . otBaseTx
  txDestination = txDestination . otBaseTx
  txGasPrice = txGasPrice . otBaseTx
  txGasLimit = txGasLimit . otBaseTx
  txCode = txCode . otBaseTx
  txData = txData . otBaseTx
  txChainId = txChainId . otBaseTx
  txMetadata = txMetadata . otBaseTx

  morphTx t =
    OutputTx
      { otOrigin = TO.Direct, -- todo: introduce a "morph" conversion?
        otHash = txHash t,
        otSigner = fromJust (txSigner t), -- todo: D A N G E R
        otBaseTx = morphTx t,
        otPrivatePayload = Nothing
      }

instance RLPSerializable OutputBlock where
  rlpEncode = rlpEncode . (morphBlock :: OutputBlock -> BDB.Block)
  rlpDecode = morphBlock . (rlpDecode :: RLPObject -> BDB.Block)

instance BlockLike BlockHeader OutputTx OutputBlock where
  blockHeader = obBlockData
  blockTransactions = obReceiptTransactions
  blockUncleHeaders = obBlockUncles

  blockOrdering = number . obBlockData
  buildBlock = OutputBlock TO.Morphism

instance Arbitrary IngestEvent where
  arbitrary = genericArbitrary

instance Arbitrary IngestTx where
  arbitrary = genericArbitrary

instance Arbitrary IngestBlock where
  arbitrary = genericArbitrary

instance Arbitrary IngestGenesis where
  arbitrary = genericArbitrary

instance Arbitrary SequencedBlock where
  arbitrary = genericArbitrary

instance Arbitrary P2pEvent where
  arbitrary = genericArbitrary

instance Arbitrary VmEvent where
  arbitrary = genericArbitrary

instance Arbitrary OutputTx where
  arbitrary = genericArbitrary

instance Arbitrary OutputBlock where
  arbitrary = genericArbitrary

instance Arbitrary OutputGenesis where
  arbitrary = genericArbitrary

instance ToJSON OutputBlock'

instance FromJSON OutputBlock'

instance ToJSON OutputTx'

instance FromJSON OutputTx'

-- just end me fam
instance Arbitrary JsonRpcCommand where
  arbitrary = JRCGetBalance <$> arbitrary <*> arbitrary <*> arbitrary

-- has to go down here because of Lens TH shenanigans
data BatchSeqLoopEvent = BatchSeqLoopEvent
  { _timerFires :: [PBFT.RoundNumber],
    _ingestEvents :: [[IngestEvent]]
  }

makeLenses ''BatchSeqLoopEvent

emptyBatchSeqLoopEvent :: BatchSeqLoopEvent
emptyBatchSeqLoopEvent = BatchSeqLoopEvent [] []

batchSeqLoopEvents :: [SeqLoopEvent] -> BatchSeqLoopEvent
batchSeqLoopEvents = foldr f emptyBatchSeqLoopEvent
  where
    f s b = case s of
      TimerFire r -> (timerFires %~ (r :)) b
      UnseqEvents r -> (ingestEvents %~ (r :)) b
