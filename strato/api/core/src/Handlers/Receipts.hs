{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE UndecidableInstances #-}

-- | REST endpoints for receipts and inclusion proofs.
--
-- @GET /receipts/hash/:hash@                 - list of receipt RLP bytes for a block
-- @GET /receipts/number/:n@                  - same, by block number
-- @GET /receipts/hash/:hash/proof/:idx@      - receipt + MPT inclusion proof at txIndex
-- @GET /receipts/number/:n/proof/:idx@       - same, by block number
--
-- The proof handler rebuilds the receipts trie in-memory from the bytes
-- persisted in @receipt_ref@ and then runs 'getInclusionProof'. Re-building
-- is safe because the bytes were captured at block-construction time and
-- match exactly what the on-chain @receiptsRoot@ commits to.
module Handlers.Receipts
  ( API,
    GetReceipts (..),
    ReceiptListResponse (..),
    ReceiptProofResponse (..),
    LogSummary (..),
    getReceiptsByHashClient,
    getReceiptsByNumberClient,
    getReceiptProofByHashClient,
    getReceiptProofByNumberClient,
    server,
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.Block (Block, blockBlockData)
import Blockchain.Data.BlockHeader (BlockHeader, clearBlockSignatures, getBlockSignatures, number)
import Blockchain.Data.DataDefs
import Blockchain.Data.RLP (RLPObject (..), RLPSerializable (..), rlpDecode, rlpDeserialize, rlpEncode, rlpSerialize)
import Blockchain.Data.ReceiptRef (receiptRefsForBlock)
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Model.JsonBlock (blockDataRefToBlock)
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.Keccak256 (Keccak256)
import Blockchain.Strato.Model.Secp256k1 (exportSignature)
import Blockchain.Strato.Model.Util (byteString2NibbleString)
import qualified Data.Text.Encoding as TE
import Control.Arrow ((&&&))
import Control.Monad.Composable.SQL
import Control.Monad.Trans.Class
import qualified Data.Text as T
import SQLM (ApiError (..))
import qualified Data.Aeson as Aeson
import qualified Data.ByteString as B
import Data.OpenApi (ToSchema)
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.Functor.Identity (runIdentity)
import qualified GHC.Generics
import qualified Database.Esqueleto.Legacy as E
import Servant
import Servant.Client
import UnliftIO

-- ============ API ============

type API =
  ReceiptsByHash
    :<|> ReceiptsByNumber
    :<|> ProofByHash
    :<|> ProofByNumber

type ReceiptsByHash =
  "receipts" :> "hash" :> Capture "blockHash" Keccak256
    :> Get '[JSON] ReceiptListResponse

type ReceiptsByNumber =
  "receipts" :> "number" :> Capture "blockNumber" Integer
    :> Get '[JSON] ReceiptListResponse

type ProofByHash =
  "receipts" :> "hash" :> Capture "blockHash" Keccak256
    :> "proof" :> Capture "txIndex" Int
    :> Get '[JSON] ReceiptProofResponse

type ProofByNumber =
  "receipts" :> "number" :> Capture "blockNumber" Integer
    :> "proof" :> Capture "txIndex" Int
    :> Get '[JSON] ReceiptProofResponse

getReceiptsByHashClient :: Keccak256 -> ClientM ReceiptListResponse
getReceiptsByNumberClient :: Integer -> ClientM ReceiptListResponse
getReceiptProofByHashClient :: Keccak256 -> Int -> ClientM ReceiptProofResponse
getReceiptProofByNumberClient :: Integer -> Int -> ClientM ReceiptProofResponse
( getReceiptsByHashClient
    :<|> getReceiptsByNumberClient
    :<|> getReceiptProofByHashClient
    :<|> getReceiptProofByNumberClient
  ) = client (Proxy @API)

-- ============ Response types ============

-- | Receipt list response: per-tx receipt RLP bytes as 0x-prefixed hex,
-- in tx-index order.
data ReceiptListResponse = ReceiptListResponse
  { rlrBlockHash :: Keccak256,
    rlrReceipts :: [String]
  }
  deriving (Show, Eq, GHC.Generics.Generic)

instance ToSchema ReceiptListResponse

instance Aeson.ToJSON ReceiptListResponse where
  toJSON r =
    Aeson.object
      [ "blockHash" Aeson..= rlrBlockHash r,
        "receipts" Aeson..= rlrReceipts r
      ]

instance Aeson.FromJSON ReceiptListResponse where
  parseJSON = Aeson.withObject "ReceiptListResponse" $ \o ->
    ReceiptListResponse
      <$> o Aeson..: "blockHash"
      <*> o Aeson..: "receipts"

-- | Receipt + inclusion proof response. The header bytes and signatures are
-- included alongside the receipt-side proof so a single REST call returns
-- everything an off-chain caller needs to drive the on-chain bridge claim:
-- @STRATOLightClient.submitHeader(headerRLP, signatures)@ followed by
-- @BridgeVault.claimWithdrawal(blockNumber, txIndex, logIndex, mptProof, receiptRLP)@.
data ReceiptProofResponse = ReceiptProofResponse
  { rprBlockHash :: Keccak256,
    rprBlockNumber :: Integer,
    rprTxIndex :: Int,
    -- | Canonical RLP of the V2 header with the @signatures@ field emptied,
    --   exactly the bytes validators signed. Suitable for @submitHeader@.
    rprHeaderRLP :: String,
    -- | Validator commit signatures, R||S||V (V in {0,1}).
    rprSignatures :: [String],
    rprReceiptRLP :: String,
    rprMptProof :: [String],
    -- | Parsed metadata for each log in the receipt, in order. Lets clients
    --   find the right @logIndex@ by name without re-parsing the RLP. We
    --   intentionally don't surface arg values here -- callers that need
    --   them can decode the relevant log from @rprReceiptRLP@ themselves.
    rprLogs :: [LogSummary]
  }
  deriving (Show, Eq, GHC.Generics.Generic)

instance ToSchema ReceiptProofResponse

data LogSummary = LogSummary
  { lsContractAddress :: Address,
    lsEventName :: String
  }
  deriving (Show, Eq, GHC.Generics.Generic)

instance ToSchema LogSummary

instance Aeson.ToJSON LogSummary where
  toJSON l =
    Aeson.object
      [ "contractAddress" Aeson..= lsContractAddress l,
        "eventName" Aeson..= lsEventName l
      ]

instance Aeson.FromJSON LogSummary where
  parseJSON = Aeson.withObject "LogSummary" $ \o ->
    LogSummary
      <$> o Aeson..: "contractAddress"
      <*> o Aeson..: "eventName"

instance Aeson.ToJSON ReceiptProofResponse where
  toJSON r =
    Aeson.object
      [ "blockHash" Aeson..= rprBlockHash r,
        "blockNumber" Aeson..= rprBlockNumber r,
        "txIndex" Aeson..= rprTxIndex r,
        "headerRLP" Aeson..= rprHeaderRLP r,
        "signatures" Aeson..= rprSignatures r,
        "receiptRLP" Aeson..= rprReceiptRLP r,
        "mptProof" Aeson..= rprMptProof r,
        "logs" Aeson..= rprLogs r
      ]

instance Aeson.FromJSON ReceiptProofResponse where
  parseJSON = Aeson.withObject "ReceiptProofResponse" $ \o ->
    ReceiptProofResponse
      <$> o Aeson..: "blockHash"
      <*> o Aeson..:? "blockNumber" Aeson..!= 0
      <*> o Aeson..: "txIndex"
      <*> o Aeson..:? "headerRLP" Aeson..!= ""
      <*> o Aeson..:? "signatures" Aeson..!= []
      <*> o Aeson..: "receiptRLP"
      <*> o Aeson..: "mptProof"
      <*> o Aeson..:? "logs" Aeson..!= []

-- ============ Server ============

server ::
  (GetReceipts m, MonadIO m) =>
  ServerT API m
server =
  receiptsByHash
    :<|> receiptsByNumber
    :<|> proofByHash
    :<|> proofByNumber

receiptsByHash :: (Monad m, GetReceipts m) => Keccak256 -> m ReceiptListResponse
receiptsByHash bh = do
  rs <- getReceiptsForBlockHash bh
  pure $ ReceiptListResponse bh (map (toHex . receiptRefReceiptBytes) rs)

receiptsByNumber ::
  (GetReceipts m, MonadIO m) =>
  Integer ->
  m ReceiptListResponse
receiptsByNumber n = do
  mbh <- resolveBlockHashByNumber n
  case mbh of
    Nothing -> liftIO $ throwIO $ CouldNotFind $ T.pack $ "no block at number " ++ show n
    Just bh -> receiptsByHash bh

proofByHash ::
  (GetReceipts m, MonadIO m) =>
  Keccak256 ->
  Int ->
  m ReceiptProofResponse
proofByHash bh txIndex = do
  rs <- getReceiptsForBlockHash bh
  let bytesByIndex = [(receiptRefTxIndex r, receiptRefReceiptBytes r) | r <- rs]
      orderedBytes = map snd bytesByIndex -- already sorted by txIndex from receiptRefsForBlock
  case lookup txIndex bytesByIndex of
    Nothing -> liftIO $ throwIO $ CouldNotFind $ T.pack $ "no receipt at txIndex " ++ show txIndex
    Just receiptBytes -> do
      mHeader <- getBlockHeaderByHash bh
      case mHeader of
        Nothing ->
          liftIO . throwIO . CouldNotFind . T.pack $
            "no block header for hash " ++ show bh
        Just hdr -> do
          let proof = computeReceiptInclusionProof orderedBytes txIndex
              logs = decodeLogSummaries receiptBytes
              sigs = getBlockSignatures hdr
              hdrSansSigs = clearBlockSignatures hdr
              headerBytes = rlpSerialize (rlpEncode hdrSansSigs)
          pure $
            ReceiptProofResponse
              { rprBlockHash = bh,
                rprBlockNumber = number hdr,
                rprTxIndex = txIndex,
                rprHeaderRLP = toHex headerBytes,
                rprSignatures = map (toHex . exportSignature) sigs,
                rprReceiptRLP = toHex receiptBytes,
                rprMptProof = map toHex proof,
                rprLogs = logs
              }

proofByNumber ::
  (GetReceipts m, MonadIO m) =>
  Integer ->
  Int ->
  m ReceiptProofResponse
proofByNumber n txIndex = do
  mbh <- resolveBlockHashByNumber n
  case mbh of
    Nothing -> liftIO $ throwIO $ CouldNotFind $ T.pack $ "no block at number " ++ show n
    Just bh -> proofByHash bh txIndex

-- | Pure: build the receipts trie from per-tx receipt bytes and produce the
-- MPT inclusion proof for @txIndex@. Mirrors the construction in
-- Verification.receiptsVerificationValue (same key = rlp(txIndex), same
-- value layout that addAllKVs uses).
computeReceiptInclusionProof :: [B.ByteString] -> Int -> [B.ByteString]
computeReceiptInclusionProof receiptsBytes targetIdx =
  let result = runIdentity . MP.runMP $ do
        let pairs =
              [ (i, ReceiptBytesWrapper bs)
              | (i, bs) <- zip [(0 :: Integer) ..] receiptsBytes
              ]
        sr <- MP.addAllKVs MP.emptyTriePtr pairs
        let key = byteString2NibbleString $ rlpSerialize $ rlpEncode (toInteger targetIdx)
        MP.getInclusionProof sr key
   in case result of
        Just (_, proof) -> proof
        Nothing -> []

-- A wrapper so we can put already-RLP-encoded receipt bytes into addAllKVs
-- without rebuilding the @Receipt@ struct. Production builds the receipts
-- trie via @addAllKVs ... [(i, receipt :: Receipt)]@, and @Receipt@'s
-- 'rlpEncode' returns an 'RLPArray', so the leaf value stored in the trie
-- is exactly the canonical receipt bytes (no extra @RLPString@ wrap).
--
-- The wrapper has to match that byte-for-byte, otherwise the proof's leaf
-- value won't equal the @receiptRLP@ bytes the on-chain verifier compares
-- against and inclusion check fails with @ProofVerificationFailed@. So
-- @rlpEncode@ here deserializes the bytes back into the same 'RLPObject'
-- shape 'Receipt'.'rlpEncode' would produce, and the round-trip
-- @rlpSerialize . rlpDeserialize = id@ guarantees the leaf bytes match.
newtype ReceiptBytesWrapper = ReceiptBytesWrapper B.ByteString

instance RLPSerializable ReceiptBytesWrapper where
  rlpEncode (ReceiptBytesWrapper bs) = rlpDeserialize bs
  rlpDecode obj = ReceiptBytesWrapper (rlpSerialize obj)

toHex :: B.ByteString -> String
toHex bs = "0x" ++ BC.unpack (B16.encode bs)

-- | Decode @[address, eventName, args]@ for each log in a receipt, returning
-- only the contract-address and event-name pair. Mirrors the Receipt RLP
-- shape used by 'Blockchain.Data.Receipt.Receipt' on the producer side: a
-- 3-element list @[status, gasUsed, [Log]]@ where each @Log@ is a 3-element
-- list. Returns @[]@ on any decode mismatch -- callers degrade to
-- empty-logs gracefully and parse the receipt RLP themselves if needed.
decodeLogSummaries :: B.ByteString -> [LogSummary]
decodeLogSummaries receiptBytes =
  case rlpDeserialize receiptBytes of
    RLPArray [_status, _gasUsed, RLPArray logs] -> map decodeOne logs
    _ -> []
  where
    decodeOne (RLPArray [addr, nameField, _args]) =
      LogSummary
        { lsContractAddress = rlpDecode addr,
          lsEventName = T.unpack . TE.decodeUtf8 . rlpDecode $ nameField
        }
    decodeOne _ = LogSummary {lsContractAddress = 0, lsEventName = ""}

-- ============ Data-access class ============

class GetReceipts m where
  getReceiptsForBlockHash :: Keccak256 -> m [ReceiptRef]
  -- | Returns Nothing if no block exists at the given number; the handler
  -- layer turns that into an HTTP 404.
  resolveBlockHashByNumber :: Integer -> m (Maybe Keccak256)
  -- | Fetch the V2 BlockHeader for a given block hash. Returns Nothing if
  -- the block doesn't exist. The proof handler uses this to attach
  -- canonical header bytes + commit signatures alongside the receipt proof.
  getBlockHeaderByHash :: Keccak256 -> m (Maybe BlockHeader)

instance (Monad m, GetReceipts m, MonadTrans t) => GetReceipts (t m) where
  getReceiptsForBlockHash = lift . getReceiptsForBlockHash
  resolveBlockHashByNumber = lift . resolveBlockHashByNumber
  getBlockHeaderByHash = lift . getBlockHeaderByHash

instance {-# OVERLAPPING #-} MonadUnliftIO m => GetReceipts (SQLM m) where
  getReceiptsForBlockHash = receiptRefsForBlock

  resolveBlockHashByNumber n = do
    rs <- sqlQuery $
      E.select $
        E.from $ \b -> do
          E.where_ $ b E.^. BlockDataRefNumber E.==. E.val n
          E.limit 1
          return (b E.^. BlockDataRefHash)
    pure $ case rs of
      (E.Value h : _) -> Just h
      [] -> Nothing

  getBlockHeaderByHash bh = do
    -- Same join pattern as Handlers.Block, narrowed to one block. We need
    -- the header reconstituted from BlockDataRef + the four side tables so
    -- the proof handler can serialize the canonical V2 header bytes (with
    -- signatures cleared) and surface the commit signatures separately.
    bdrs <- fmap (map (E.entityKey &&& E.entityVal)) . sqlQuery $
      E.select $
        E.from $ \bdRef -> do
          E.where_ $ bdRef E.^. BlockDataRefHash E.==. E.val bh
          E.limit 1
          return bdRef
    case bdrs of
      [] -> pure Nothing
      ((bdrId, bdr) : _) -> do
        vs <- fmap (map E.entityVal) . sqlQuery $
          E.select $
            E.from $ \v -> do
              E.where_ $ v E.^. BlockValidatorRefBlockDataRefId E.==. E.val bdrId
              return v
        vd <- fmap (map E.entityVal) . sqlQuery $
          E.select $
            E.from $ \v -> do
              E.where_ $ v E.^. ValidatorDeltaRefBlockDataRefId E.==. E.val bdrId
              return v
        ps <- fmap (map E.entityVal) . sqlQuery $
          E.select $
            E.from $ \v -> do
              E.where_ $ v E.^. ProposalSignatureRefBlockDataRefId E.==. E.val bdrId
              return v
        ss <- fmap (map E.entityVal) . sqlQuery $
          E.select $
            E.from $ \v -> do
              E.where_ $ v E.^. CommitmentSignatureRefBlockDataRefId E.==. E.val bdrId
              return v
        -- The proof handler doesn't use blockReceiptTransactions; pass [].
        let block :: Block
            block = blockDataRefToBlock bdr vs vd ps ss []
        pure . Just $ blockBlockData block
