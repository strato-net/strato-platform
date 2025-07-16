{-# LANGUAGE DeriveAnyClass        #-}
{-# LANGUAGE DeriveDataTypeable    #-}
{-# LANGUAGE DeriveGeneric         #-}
{-# LANGUAGE MultiParamTypeClasses #-}

module Blockchain.Model.WrappedBlock (
  IngestTx(..),
  OutputTx(..),
  IngestBlock(..),
  OutputBlock(..),
  SequencedBlock(..),
  outputBlockToBlockRetainPayloads,
  outputBlockToBlock,
  sequencedBlockToOutputBlock,
  wrapIngestBlockTransaction,
  wrapIngestBlockTransactionUnanchored,
  blockToIngestBlock,
  ingestBlockToSequencedBlock,
  sequencedBlockToBlock,
  wrapTransaction,
  wrapTransactionUnanchored,
  outputBlockHash
  ) where

import qualified Blockchain.Data.Block             as BDB
import           Blockchain.Data.BlockHeader
import           Blockchain.Data.RLP
import qualified Blockchain.Data.Transaction       as TX
import qualified Blockchain.Data.TXOrigin          as TO
import           Blockchain.DB.Witnessable
import qualified Blockchain.Strato.Model.Address   as A
import           Blockchain.Strato.Model.Class
import           Blockchain.Strato.Model.Keccak256 (Keccak256)
import           Control.DeepSeq
import           Data.Binary
import           Data.Data
import           Data.Maybe                        (fromJust, fromMaybe)
import qualified GHC.Generics                      as GHCG
import           Test.QuickCheck
import           Test.QuickCheck.Arbitrary.Generic
import qualified Text.Colors                       as CL
import           Text.Format
import           Text.Tools

data IngestTx = IngestTx
  { itOrigin      :: TO.TXOrigin,
    itTransaction :: TX.Transaction
  }
  deriving (Eq, Read, Show, GHCG.Generic)

data IngestBlock = IngestBlock
  { ibOrigin              :: TO.TXOrigin,
    ibBlockData           :: BlockHeader,
    ibReceiptTransactions :: [TX.Transaction],
    ibBlockUncles         :: [BlockHeader]
  }
  deriving (Eq, Show, GHCG.Generic)

data SequencedBlock = SequencedBlock
  { sbOrigin              :: TO.TXOrigin,
    sbHash                :: Keccak256,
    sbBlockData           :: BlockHeader,
    sbReceiptTransactions :: [OutputTx],
    sbBlockUncles         :: [BlockHeader]
  }
  deriving (Show, GHCG.Generic)

data OutputTx = OutputTx
  { otOrigin         :: TO.TXOrigin,
    otHash           :: Keccak256,
    otSigner         :: A.Address,
    otBaseTx         :: TX.Transaction,
    otPrivatePayload :: Maybe TX.Transaction
  }
  deriving (Eq, Read, Show, GHCG.Generic, NFData, Data)

data OutputBlock = OutputBlock
  { obOrigin              :: TO.TXOrigin,
    obBlockData           :: BlockHeader,
    obReceiptTransactions :: [OutputTx],
    obBlockUncles         :: [BlockHeader]
  }
  deriving (Eq, Show, GHCG.Generic)

{-
data OutputGenesis = OutputGenesis
  { ogOrigin :: TO.TXOrigin,
    ogGenesisInfo :: (Word256, ChainInfo)
  }
  deriving (Eq, Show, GHCG.Generic, Data)
-}
blockToIngestBlock :: TO.TXOrigin -> BDB.Block -> IngestBlock
blockToIngestBlock origin BDB.Block {BDB.blockBlockData = bd, BDB.blockReceiptTransactions = txs, BDB.blockBlockUncles = us} =
  IngestBlock {ibOrigin = origin, ibBlockData = bd, ibReceiptTransactions = txs, ibBlockUncles = us}

ingestBlockToSequencedBlock :: IngestBlock -> Maybe SequencedBlock
ingestBlockToSequencedBlock ib = do
  let theHash = blockHeaderHash $ ibBlockData ib
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

ingestBlockHash :: IngestBlock -> Keccak256
ingestBlockHash = blockHeaderHash . ibBlockData

outputBlockHash :: OutputBlock -> Keccak256
outputBlockHash = blockHeaderHash . obBlockData

outputBlockToBlock :: OutputBlock -> BDB.Block
outputBlockToBlock OutputBlock {obBlockData = bd, obReceiptTransactions = txs, obBlockUncles = us} = BDB.Block bd (otBaseTx <$> txs) us

outputBlockToBlockRetainPayloads :: OutputBlock -> BDB.Block
outputBlockToBlockRetainPayloads OutputBlock {obBlockData = bd, obReceiptTransactions = txs, obBlockUncles = us} =
  let payload t = fromMaybe (otBaseTx t) (otPrivatePayload t)
   in BDB.Block bd (payload <$> txs) us

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

instance Binary SequencedBlock

instance Binary OutputTx

instance Binary OutputBlock

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
  txNetwork = txNetwork . otBaseTx
  txType = txType . otBaseTx
  txSignature = txSignature . otBaseTx
  txFuncName = txFuncName . otBaseTx
  txContractName = txContractName . otBaseTx
  txArgs = txArgs . otBaseTx
  txDestination = txDestination . otBaseTx
  txGasLimit = txGasLimit . otBaseTx
  txCode = txCode . otBaseTx

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

instance Arbitrary IngestTx where
  arbitrary = genericArbitrary

instance Arbitrary IngestBlock where
  arbitrary = genericArbitrary

instance Arbitrary SequencedBlock where
  arbitrary = genericArbitrary

instance Arbitrary OutputTx where
  arbitrary = genericArbitrary

instance Arbitrary OutputBlock where
  arbitrary = genericArbitrary
