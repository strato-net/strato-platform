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
    getReceiptsByHashClient,
    getReceiptsByNumberClient,
    getReceiptProofByHashClient,
    getReceiptProofByNumberClient,
    server,
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.DataDefs
import Blockchain.Data.RLP (RLPObject (..), RLPSerializable (..), rlpEncode, rlpSerialize)
import Blockchain.Data.ReceiptRef (receiptRefsForBlock)
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Strato.Model.Keccak256 (Keccak256)
import Blockchain.Strato.Model.Util (byteString2NibbleString)
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

-- | Receipt + inclusion proof response.
data ReceiptProofResponse = ReceiptProofResponse
  { rprBlockHash :: Keccak256,
    rprTxIndex :: Int,
    rprReceiptRLP :: String,
    rprMptProof :: [String]
  }
  deriving (Show, Eq, GHC.Generics.Generic)

instance ToSchema ReceiptProofResponse

instance Aeson.ToJSON ReceiptProofResponse where
  toJSON r =
    Aeson.object
      [ "blockHash" Aeson..= rprBlockHash r,
        "txIndex" Aeson..= rprTxIndex r,
        "receiptRLP" Aeson..= rprReceiptRLP r,
        "mptProof" Aeson..= rprMptProof r
      ]

instance Aeson.FromJSON ReceiptProofResponse where
  parseJSON = Aeson.withObject "ReceiptProofResponse" $ \o ->
    ReceiptProofResponse
      <$> o Aeson..: "blockHash"
      <*> o Aeson..: "txIndex"
      <*> o Aeson..: "receiptRLP"
      <*> o Aeson..: "mptProof"

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
      let proof = computeReceiptInclusionProof orderedBytes txIndex
      pure $
        ReceiptProofResponse
          { rprBlockHash = bh,
            rprTxIndex = txIndex,
            rprReceiptRLP = toHex receiptBytes,
            rprMptProof = map toHex proof
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
-- without double-encoding them. The trie value at each leaf becomes
-- @RLPString receiptBytes@ -- exactly what the on-chain verifier expects.
newtype ReceiptBytesWrapper = ReceiptBytesWrapper B.ByteString

instance RLPSerializable ReceiptBytesWrapper where
  rlpEncode (ReceiptBytesWrapper bs) = RLPString bs
  rlpDecode (RLPString bs) = ReceiptBytesWrapper bs
  rlpDecode _ = error "ReceiptBytesWrapper.rlpDecode: expected RLPString"

toHex :: B.ByteString -> String
toHex bs = "0x" ++ BC.unpack (B16.encode bs)

-- ============ Data-access class ============

class GetReceipts m where
  getReceiptsForBlockHash :: Keccak256 -> m [ReceiptRef]
  -- | Returns Nothing if no block exists at the given number; the handler
  -- layer turns that into an HTTP 404.
  resolveBlockHashByNumber :: Integer -> m (Maybe Keccak256)

instance (Monad m, GetReceipts m, MonadTrans t) => GetReceipts (t m) where
  getReceiptsForBlockHash = lift . getReceiptsForBlockHash
  resolveBlockHashByNumber = lift . resolveBlockHashByNumber

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
