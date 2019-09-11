{-# LANGUAGE DeriveDataTypeable    #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TemplateHaskell       #-}
module Blockchain.Sequencer.Event where

import           Control.DeepSeq
import           Data.Aeson                                hiding (encode)
import           Data.Binary
import           Data.Data
import           Data.Functor.Identity
import           Data.List                                 (intercalate)
import           Data.Maybe                                (fromJust, isNothing)
import           Data.DeriveTH
import           Test.QuickCheck

import qualified Blockchain.Data.Address                   as A
import           Blockchain.Data.Block                     (Block)
import qualified Blockchain.Data.BlockDB                   as BDB
import qualified Blockchain.Data.DataDefs                  as DD
import           Blockchain.Data.ChainInfo
import           Blockchain.Data.Enode
import           Blockchain.Data.Json
import           Blockchain.Data.RLP
import qualified Blockchain.Data.Transaction               as TX
import qualified Blockchain.Data.TXOrigin                  as TO
import           Blockchain.ExtWord                        (Word256)

import qualified GHC.Generics                              as GHCG

import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.SHA               (SHA (..))
import           Blockchain.Util

import qualified Blockchain.Blockstanbul                   as PBFT
import qualified Blockchain.Blockstanbul.HTTPAdmin         as PBFT

import           Blockchain.Sequencer.DB.Witnessable
import qualified Data.ByteString                           as BS
import qualified Data.ByteString.Lazy                      as B

import           Blockchain.Sequencer.BinaryInstances      ()

import qualified Text.Colors                               as CL
import           Text.Format

data AnchorChain = Public
                 | UnknownPrivate       -- TODO: It's possible these two aren't needed,
                 | KnownPrivate Word256 --       but I'm leaving them in for now.
                 | AnchoredPrivate Word256
                 deriving (Eq, Ord, Show, Read, GHCG.Generic, NFData, Data, ToJSON, FromJSON)

getAnchorChain :: (Monad m, TransactionLike t) => (SHA -> m (Maybe Word256)) -> t -> m AnchorChain
getAnchorChain f tx =
  if txType tx == PrivateHash
    then f (txChainHash tx) >>= \case
      Just anchor -> return $ AnchoredPrivate anchor
      Nothing -> return UnknownPrivate
    else return . maybe Public KnownPrivate $ txChainId tx

getAnchorChainUnanchored :: TransactionLike t => t -> AnchorChain
getAnchorChainUnanchored = runIdentity . getAnchorChain (const (Identity Nothing))

isAnchored :: AnchorChain -> Bool
isAnchored Public              = True
isAnchored (AnchoredPrivate _) = True
isAnchored _                   = False

isAnchoredPrivate :: AnchorChain -> Bool
isAnchoredPrivate (AnchoredPrivate _) = True
isAnchoredPrivate _                   = False

-- Transactions that are anchored (Public or AnchoredPrivate), and the anchors are correct
isAnchoredCorrectly :: TransactionLike t => AnchorChain -> t -> Bool
isAnchoredCorrectly Public                tx = isNothing (txChainId tx) && (txType tx /= PrivateHash)
isAnchoredCorrectly (AnchoredPrivate cId) tx = txChainId tx == Just cId
isAnchoredCorrectly _                     _  = False

-- Transactions that may or may not be anchored, but that status matches the transaction payload
hasCorrectAnchor :: TransactionLike t => AnchorChain -> t -> Bool
hasCorrectAnchor Public                tx = isNothing (txChainId tx) && (txType tx /= PrivateHash)
hasCorrectAnchor (AnchoredPrivate cId) tx = txChainId tx == Just cId
hasCorrectAnchor UnknownPrivate        tx = txType tx == PrivateHash
hasCorrectAnchor _                     _  = False

fromAnchorChain :: AnchorChain -> Maybe Word256
fromAnchorChain (AnchoredPrivate cId) = Just cId
fromAnchorChain _                     = Nothing

filterAnchoredTxs :: OutputBlock -> OutputBlock
filterAnchoredTxs ob = ob{obReceiptTransactions = filter f (obReceiptTransactions ob)}
  where f otx = hasCorrectAnchor (otAnchorChain otx) otx

data SeqLoopEvent = TimerFire PBFT.RoundNumber
                  | VoteMade PBFT.CandidateReceived
                  | UnseqEvent IngestEvent
                  | WaitTerminated
                  deriving (Eq, Show, GHCG.Generic)

instance Format SeqLoopEvent where
  format (TimerFire rn) = "TimerFire " ++ format rn
  format (VoteMade vote) = "VoteMade " ++ show vote
  format (UnseqEvent ev) = "UnseqEvent " ++ format ev
  format WaitTerminated = "WaitTerminated"

data IngestEvent = IETx Timestamp IngestTx
                 | IEBlock IngestBlock
                 | IEGenesis IngestGenesis
                 | IENewChainMember Word256 A.Address Enode
                 | IEBlockstanbul PBFT.WireMessage
                 | IEForcedConfigChange PBFT.ForcedConfigChange
                 deriving (Eq, Show, GHCG.Generic, Data)

data IngestEventType = IETTransaction
                     | IETBlock
                     | IETGenesis
                     | IETNewChainMember
                     | IETBlockstanbul
                     | IETForcedConfigChange
                     deriving (Eq, Ord, Show)

iEventType :: IngestEvent -> IngestEventType
iEventType = \case
  IETx{}                 -> IETTransaction
  IEBlock{}              -> IETBlock
  IEGenesis{}            -> IETGenesis
  IENewChainMember{}     -> IETNewChainMember
  IEBlockstanbul{}       -> IETBlockstanbul
  IEForcedConfigChange{} -> IETForcedConfigChange

instance Format IngestEvent where
  format (IETx ts o) = show ts ++ " " ++ format o
  format (IEBlock o) = format o
  format (IEGenesis o) = show o
  format (IENewChainMember c a e) = intercalate ", " [format (SHA c), format a, show e]
  format (IEBlockstanbul o) = format o
  format (IEForcedConfigChange o) = format o

type Timestamp = Microtime

data IngestTx = IngestTx { itOrigin      :: TO.TXOrigin
                         , itTransaction :: TX.Transaction
                         } deriving (Eq, Read, Show, GHCG.Generic, Data)

data IngestBlock = IngestBlock { ibOrigin              :: TO.TXOrigin
                               , ibBlockData           :: DD.BlockData
                               , ibReceiptTransactions :: [TX.Transaction]
                               , ibBlockUncles         :: [DD.BlockData]
                               } deriving (Eq, Read, Show, GHCG.Generic, Data)

data IngestGenesis = IngestGenesis { igOrigin          :: TO.TXOrigin
                                   , igGenesisInfo     :: (Word256, ChainInfo)
                                   } deriving (Eq, Show, GHCG.Generic, Data)

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
    deriving (Eq, Read, Show, GHCG.Generic, Data)

data OutputEvent = OETx Timestamp OutputTx
                 | OEBlock OutputBlock
                 | OEGenesis OutputGenesis
                 | OEJsonRpcCommand JsonRpcCommand
                 | OEGetChain [Word256]
                 | OEGetTx [SHA]
                 | OENewChainMember Word256 A.Address Enode
                 | OEBlockstanbul PBFT.WireMessage
                 | OECreateBlockCommand
                 -- Ask and push for inclusive ranges of blocks
                 | OEAskForBlocks {oeAskStart :: Integer, oeAskEnd :: Integer, oeAskPeer :: A.Address}
                 | OEPushBlocks {oePushStart :: Integer, oePushEnd :: Integer, oePushPeer :: A.Address}
                 | OEVoteToMake { oeVoteRecipient :: A.Address, oeVoteVotingDir :: Bool, oeVoteSender :: A.Address }
                 | OENewCheckpoint PBFT.Checkpoint -- A pseudo out event that shouldn't leave the sequencer
                 | OEPrivateTx OutputTx
                 deriving (Eq, Show, GHCG.Generic, Data)

instance Format OutputEvent where
  format (OETx ts o)              = show ts ++ " " ++ format o
  format (OEBlock o)              = format o
  format (OEGenesis o)            = show o
  format (OEGetChain cids)        = "[" ++ (intercalate "," $ map (format . SHA) cids) ++ "]"
  format (OEGetTx shas)           = "[" ++ (intercalate "," $ map format shas) ++ "]"
  format (OENewChainMember c a e) = intercalate ", " [format (SHA c), format a, show e]
  format (OEBlockstanbul o)       = format o
  format (OEPrivateTx o)          = format o
  format x                        = show x

data OutputSeqP2pEvent =
    OSPETx OutputTx
  | OSPEBlock OutputBlock
  | OSPEGenesis OutputGenesis
  | OSPEGetChain [Word256]
  | OSPEGetTx [SHA]
  | OSPENewChainMember Word256 A.Address Enode
  | OSPEBlockstanbul PBFT.WireMessage
  -- Ask and push for inclusive ranges of blocks
  | OSPEAskForBlocks {ospeAskStart :: Integer, ospeAskEnd :: Integer, ospeAskPeer :: A.Address}
  | OSPEPushBlocks {ospePushStart :: Integer, ospePushEnd :: Integer, ospePushPeer :: A.Address}
  deriving (Eq, Show, GHCG.Generic, Data)

instance Format OutputSeqP2pEvent where
  format (OSPETx o)                 = format o
  format (OSPEBlock o)              = format o
  format (OSPEGenesis o)            = show o
  format (OSPEGetChain cids)        = "[" ++ (intercalate "," $ map (format . SHA) cids) ++ "]"
  format (OSPEGetTx shas)           = "[" ++ (intercalate "," $ map format shas) ++ "]"
  format (OSPENewChainMember c a e) = intercalate ", " [format (SHA c), format a, show e]
  format (OSPEBlockstanbul o)       = format o
  format x                          = show x

data OutputSeqVmEvent =
    OSVETx Timestamp OutputTx
  | OSVEBlock OutputBlock
  | OSVEGenesis OutputGenesis
  | OSVEJsonRpcCommand JsonRpcCommand
  | OSVECreateBlockCommand
  | OSVEVoteToMake { osveVoteRecipient :: A.Address, osveVoteVotingDir :: Bool, osveVoteSender :: A.Address }
  | OSVEPrivateTx OutputTx
  deriving (Eq, Show, GHCG.Generic, Data)

instance Format OutputSeqVmEvent where
  format (OSVETx ts o)              = show ts ++ " " ++ format o
  format (OSVEBlock o)              = format o
  format (OSVEGenesis o)            = show o
  format x                          = show x

data OutputTx = OutputTx { otOrigin      :: TO.TXOrigin
                         , otHash        :: SHA
                         , otSigner      :: A.Address
                         , otAnchorChain :: AnchorChain
                         , otBaseTx      :: TX.Transaction
                         } deriving (Eq, Read, Show, GHCG.Generic, NFData, Data)

data OutputTx' = OutputTx' { ot'Origin      :: TO.TXOrigin
                           , ot'Hash        :: SHA
                           , ot'Signer      :: A.Address
                           , ot'AnchorChain :: AnchorChain
                           , ot'BaseTx      :: Transaction'
                           } deriving (Eq, Show, GHCG.Generic)

otxToOtxPrime :: OutputTx -> OutputTx'
otxToOtxPrime (OutputTx o h s a b) = (OutputTx' o h s a (Transaction' b))

otxPrimeToOtx :: OutputTx' -> OutputTx
otxPrimeToOtx (OutputTx' o h s a (Transaction' b)) = OutputTx o h s a b

data OutputBlock = OutputBlock { obOrigin              :: TO.TXOrigin
                               , obTotalDifficulty     :: Integer
                               , obBlockData           :: DD.BlockData
                               , obReceiptTransactions :: [OutputTx]
                               , obBlockUncles         :: [DD.BlockData]
                               } deriving (Eq, Read, Show, GHCG.Generic, Data)

data OutputBlock' = OutputBlock' { ob'Origin              :: TO.TXOrigin
                                 , ob'TotalDifficulty     :: Integer
                                 , ob'BlockData           :: BlockData'
                                 , ob'ReceiptTransactions :: [OutputTx']
                                 , ob'BlockUncles         :: [BlockData']
                                 } deriving (Eq, Show, GHCG.Generic)

obToObPrime :: OutputBlock -> OutputBlock'
obToObPrime (OutputBlock o td bd rt bu) =
  OutputBlock' o td (BlockData' bd)
                    (otxToOtxPrime <$> rt)
                    (BlockData' <$> bu)

obPrimeToOb :: OutputBlock' -> OutputBlock
obPrimeToOb (OutputBlock' o td (BlockData' bd) rt bu) =
  OutputBlock o td bd (otxPrimeToOtx <$> rt)
                      ((\(BlockData' b) -> b) <$> bu)

data OutputGenesis = OutputGenesis { ogOrigin          :: TO.TXOrigin
                                   , ogGenesisInfo     :: (Word256, ChainInfo)
                                   } deriving (Eq, Show, GHCG.Generic, Data)

ingestGenesisToOutputGenesis :: IngestGenesis -> OutputGenesis
ingestGenesisToOutputGenesis (IngestGenesis o g) = OutputGenesis o g

blockToIngestBlock :: TO.TXOrigin -> Block -> IngestBlock
blockToIngestBlock origin BDB.Block{BDB.blockBlockData=bd,BDB.blockReceiptTransactions=txs,BDB.blockBlockUncles=us} =
    IngestBlock{ibOrigin = origin, ibBlockData = bd, ibReceiptTransactions = txs, ibBlockUncles = us}

ingestBlockToBlock :: IngestBlock -> BDB.Block
ingestBlockToBlock IngestBlock{ibBlockData=bd, ibReceiptTransactions = txs, ibBlockUncles = us} =
    BDB.Block{BDB.blockBlockData = bd, BDB.blockReceiptTransactions = txs, BDB.blockBlockUncles = us}

ingestBlockToSequencedBlock :: Monad m => (SHA -> m (Maybe Word256)) -> IngestBlock -> m (Maybe SequencedBlock)
ingestBlockToSequencedBlock f ib = do
  let theHash = (BDB.blockHeaderHash . ibBlockData $ ib)
  otxs <- traverse (wrapIngestBlockTransaction f theHash) $ ibReceiptTransactions ib
  return $ case sequence otxs of
    Nothing -> Nothing
    Just outputTxs -> Just SequencedBlock
      { sbOrigin              = ibOrigin ib
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

wrapTransaction :: Monad m => (SHA -> m (Maybe Word256)) -> IngestTx -> m (Maybe OutputTx)
wrapTransaction f tx@IngestTx{} = do
  let baseTx = itTransaction tx
  case TX.whoSignedThisTransaction baseTx of
    Nothing -> return Nothing
    Just signer -> do
      anchor <- getAnchorChain f baseTx
      return $ Just OutputTx
        { otOrigin = itOrigin tx
        , otHash   = TX.transactionHash baseTx
        , otSigner = signer
        , otAnchorChain = anchor
        , otBaseTx = baseTx
        }

wrapTransactionUnanchored :: IngestTx -> Maybe OutputTx
wrapTransactionUnanchored tx@IngestTx{} =
  let baseTx = itTransaction tx
   in case TX.whoSignedThisTransaction baseTx of
        Nothing -> Nothing
        Just signer ->
          let anchor = getAnchorChainUnanchored baseTx
           in Just OutputTx
                { otOrigin = itOrigin tx
                , otHash   = TX.transactionHash baseTx
                , otSigner = signer
                , otAnchorChain = anchor
                , otBaseTx = baseTx
                }

wrapIngestBlockTransaction :: Monad m => (SHA -> m (Maybe Word256)) -> SHA -> TX.Transaction -> m (Maybe OutputTx)
wrapIngestBlockTransaction f hash tx =
  case TX.whoSignedThisTransaction tx of
    Nothing -> return Nothing
    Just signer -> do
      anchor <- getAnchorChain f tx
      return $ Just OutputTx
        { otOrigin = TO.BlockHash hash
        , otSigner = signer
        , otBaseTx = tx
        , otAnchorChain = anchor
        , otHash   = TX.transactionHash tx
        }

wrapIngestBlockTransactionUnanchored :: SHA -> TX.Transaction -> Maybe OutputTx
wrapIngestBlockTransactionUnanchored hash tx =
  case TX.whoSignedThisTransaction tx of
    Nothing -> Nothing
    Just signer ->
      let anchor = getAnchorChainUnanchored tx
       in Just OutputTx
            { otOrigin = TO.BlockHash hash
            , otSigner = signer
            , otBaseTx = tx
            , otAnchorChain = anchor
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

quarryBlockToOutputBlock :: Monad m => (SHA -> m (Maybe Word256)) -> BDB.Block -> m OutputBlock
quarryBlockToOutputBlock f BDB.Block{BDB.blockBlockData=bd,BDB.blockReceiptTransactions=txs,BDB.blockBlockUncles=us} = do
  rtxs <- mapM wrapQuarryReceipt txs
  return OutputBlock
    { obOrigin              = TO.Quarry
    , obBlockData           = bd
    , obBlockUncles         = us
    , obReceiptTransactions = rtxs
    , obTotalDifficulty     = 0
    }

    where wrapQuarryReceipt t = do
            anchor <- getAnchorChain f t
            return OutputTx
              { otOrigin = TO.Quarry
              , otBaseTx = t
              , otSigner = fromJust . TX.whoSignedThisTransaction $ t
              , otAnchorChain = anchor
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

instance Binary AnchorChain where
instance Binary IngestTx where
instance Binary IngestBlock where
instance Binary IngestGenesis where
instance Binary SequencedBlock where
instance Binary OutputTx where
instance Binary OutputBlock where
instance Binary OutputGenesis where
instance Binary IngestEvent where
instance Binary JsonRpcCommand where
instance Binary OutputSeqP2pEvent where
instance Binary OutputSeqVmEvent where

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
              else tab (show $ length receipts)) ++
             (if null uncles
              then "        (no uncles)"
              else tab (show $ length uncles)))

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
              else tab (show $ length receipts)) ++
             (if null uncles
              then "        (no uncles)"
              else tab (show $ length uncles)))

instance Format OutputTx where
    format OutputTx{ otOrigin = origin
                   , otSigner = signer
                   , otAnchorChain = anchor
                   , otBaseTx = base
                   } =
           CL.red("OutputTx from address " ++ format signer ++ " on chain " ++ show anchor)
                ++ tab (" via " ++ format origin ++ "\n" ++ format (txHash base))

instance Format IngestTx where
    format IngestTx{ itOrigin      = origin
                   , itTransaction = base
                   } =
           CL.red("IngestTx via " ++ format origin ++ "\n" ++ tab (format $ txHash base))

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
    txAnchorChain = fromAnchorChain . otAnchorChain

    morphTx t = OutputTx { otOrigin = TO.Direct -- todo: introduce a "morph" conversion?
                         , otHash   = txHash t
                         , otSigner = fromJust (txSigner t) -- todo: D A N G E R
                         , otAnchorChain = runIdentity $ getAnchorChain (const (Identity Nothing)) t
                         , otBaseTx = morphTx t
                         }

instance RLPSerializable OutputBlock where
    rlpEncode = rlpEncode . (morphBlock :: OutputBlock -> Block)
    rlpDecode = morphBlock . (rlpDecode :: RLPObject -> Block)

instance BlockLike DD.BlockData OutputTx OutputBlock where
    blockHeader       = obBlockData
    blockTransactions = obReceiptTransactions
    blockUncleHeaders = obBlockUncles

    blockOrdering = DD.blockDataNumber . obBlockData
    buildBlock = OutputBlock TO.Morphism 0

derive makeArbitrary ''AnchorChain
derive makeArbitrary ''IngestEvent
derive makeArbitrary ''IngestTx
derive makeArbitrary ''IngestBlock
derive makeArbitrary ''IngestGenesis
derive makeArbitrary ''SequencedBlock
derive makeArbitrary ''OutputEvent
derive makeArbitrary ''OutputSeqP2pEvent
derive makeArbitrary ''OutputSeqVmEvent
derive makeArbitrary ''OutputTx
derive makeArbitrary ''OutputBlock
derive makeArbitrary ''OutputGenesis

instance ToJSON OutputBlock' where
instance FromJSON OutputBlock' where
instance ToJSON OutputTx' where
instance FromJSON OutputTx' where

-- just end me fam
instance Arbitrary JsonRpcCommand where
   arbitrary = JRCGetBalance <$> arbitrary <*> arbitrary <*> arbitrary
