{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

-- | REST endpoint for Merkle-Patricia proofs of chain state.
--
-- @GET /state/proof/:address?path=..&path=..[&blockNumber=n | &blockHash=h]@
--
-- Returns, for one block (the latest when none is given), the signed header
-- and the proofs of the account at @address@ and of the given items of its
-- SolidVM storage against that header's @stateRoot@ (the state after the
-- block's transactions). Verification chain:
--
--   * account trie key = @keccak256(20-byte address)@; the leaf's value is an
--     RLP string wrapping @accountLeaf@ =
--     @rlp([nonce, balance, contractRoot, codeHash(, chainId)])@
--   * storage trie root = @contractRoot@; trie key (@key@) =
--     @keccak256(path)@, the path being the ASCII storage path as in the
--     request (mapping keys: integers in decimal, addresses as 40 lowercase
--     hex digits); the leaf's value is @value@ embedded as is: the RLP list
--     of the BasicValue (an integer @n@ is @[0x00, n]@)
--
-- The state trie lives in the VM, so the proofs come from the node's
-- ethereum-jsonrpc service (@strato_getStateProof@) for the state root of the
-- header returned here: header and proofs always describe the same state.
module Handlers.StateProof
  ( API,
    StateProofResponse (..),
    StorageItemProof (..),
    getStateProofClient,
    server,
  )
where

import Blockchain.Data.Block (blockBlockData)
import Blockchain.Data.BlockHeader (BlockHeader, clearBlockSignatures, getBlockSignatures, number, stateRoot)
import Blockchain.Data.RLP (rlpEncode, rlpSerialize)
import Blockchain.EthConf (ethConf)
import Blockchain.EthConf.Model (apiConfig, apiListenAddress, jsonRpcPort)
import Blockchain.Sequencer.HexData (HexData (..))
import Blockchain.Sequencer.StateProof (StateProof (..), StorageProof (..))
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.Class (blockHash)
import Blockchain.Strato.Model.Keccak256 (Keccak256)
import Blockchain.Strato.Model.Secp256k1 (exportSignature)
import Blockchain.Strato.Model.StateRoot (unboxStateRoot)
import Control.Monad (zipWithM)
import qualified Data.Aeson as Aeson
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.OpenApi (ToSchema)
import qualified Data.Text as T
import qualified GHC.Generics
import Handlers.BlkLast (GetLastBlocks (..))
import Handlers.Receipts (GetReceipts (..))
import JsonRpcClient (jsonRpcCall)
import SQLM (ApiError (..))
import Servant
import Servant.Client
import SolidVM.Model.Storable (StoragePath, unparsePath)
import UnliftIO

-- ============ API ============

type API =
  "state" :> "proof" :> Capture "address" Address
    :> QueryParams "path" StoragePath
    :> QueryParam "blockNumber" Integer
    :> QueryParam "blockHash" Keccak256
    :> Get '[JSON] StateProofResponse

getStateProofClient :: Address -> [StoragePath] -> Maybe Integer -> Maybe Keccak256 -> ClientM StateProofResponse
getStateProofClient = client (Proxy @API)

-- ============ Response types ============

-- | Proof of one storage item. All byte fields are 0x-prefixed hex.
data StorageItemProof = StorageItemProof
  { sipPath :: StoragePath,
    -- | The trie key: keccak256 of the ASCII path.
    sipKey :: String,
    -- | RLP trie nodes from the account's storage root to the leaf.
    sipProof :: [String],
    -- | The leaf's value item exactly as encoded in the trie.
    sipValue :: String
  }
  deriving (Show, Eq, GHC.Generics.Generic)

instance ToSchema StorageItemProof

instance Aeson.ToJSON StorageItemProof where
  toJSON s =
    Aeson.object
      [ "path" Aeson..= sipPath s,
        "key" Aeson..= sipKey s,
        "proof" Aeson..= sipProof s,
        "value" Aeson..= sipValue s
      ]

instance Aeson.FromJSON StorageItemProof where
  parseJSON = Aeson.withObject "StorageItemProof" $ \o ->
    StorageItemProof
      <$> o Aeson..: "path"
      <*> o Aeson..: "key"
      <*> o Aeson..: "proof"
      <*> o Aeson..: "value"

-- | Signed header + account proof + storage proofs, all for one block. All
-- byte fields are 0x-prefixed hex.
data StateProofResponse = StateProofResponse
  { sprBlockNumber :: Integer,
    sprBlockHash :: Keccak256,
    -- | Canonical RLP of the header with the @signatures@ field emptied,
    --   exactly the bytes validators signed (as in the receipt proof route).
    sprHeaderRLP :: String,
    -- | Validator commit signatures, R||S||V (V in {0,1}).
    sprSignatures :: [String],
    sprAddress :: Address,
    -- | RLP trie nodes from the header's stateRoot to the account leaf.
    sprAccountProof :: [String],
    -- | The account RLP held by the leaf's value item.
    sprAccountLeaf :: String,
    sprStorage :: [StorageItemProof]
  }
  deriving (Show, Eq, GHC.Generics.Generic)

instance ToSchema StateProofResponse

instance Aeson.ToJSON StateProofResponse where
  toJSON r =
    Aeson.object
      [ "blockNumber" Aeson..= sprBlockNumber r,
        "blockHash" Aeson..= sprBlockHash r,
        "headerRLP" Aeson..= sprHeaderRLP r,
        "signatures" Aeson..= sprSignatures r,
        "address" Aeson..= sprAddress r,
        "accountProof" Aeson..= sprAccountProof r,
        "accountLeaf" Aeson..= sprAccountLeaf r,
        "storage" Aeson..= sprStorage r
      ]

instance Aeson.FromJSON StateProofResponse where
  parseJSON = Aeson.withObject "StateProofResponse" $ \o ->
    StateProofResponse
      <$> o Aeson..: "blockNumber"
      <*> o Aeson..: "blockHash"
      <*> o Aeson..: "headerRLP"
      <*> o Aeson..: "signatures"
      <*> o Aeson..: "address"
      <*> o Aeson..: "accountProof"
      <*> o Aeson..: "accountLeaf"
      <*> o Aeson..: "storage"

-- ============ Server ============

server :: (GetReceipts m, GetLastBlocks m, MonadIO m) => ServerT API m
server = stateProof

stateProof ::
  (GetReceipts m, GetLastBlocks m, MonadIO m) =>
  Address ->
  [StoragePath] ->
  Maybe Integer ->
  Maybe Keccak256 ->
  m StateProofResponse
stateProof addr paths mNumber mHash = do
  (bh, hdr) <- case (mHash, mNumber) of
    (Just bh, _) -> headerByHash bh
    (_, Just n) ->
      resolveBlockHashByNumber n
        >>= maybe (notFound $ "no block at number " ++ show n) headerByHash
    _ ->
      getLastBlocks 1 >>= \case
        blk : _ -> pure (blockHash blk, blockBlockData blk)
        [] -> notFound "no blocks"
  proof <-
    jsonRpcCall
      vmJsonRpcUrl
      "strato_getStateProof"
      [ Aeson.toJSON . HexData . unboxStateRoot $ stateRoot hdr,
        Aeson.toJSON addr,
        Aeson.toJSON $ map (HexData . unparsePath) paths
      ]
      >>= \case
        Left err -> liftIO . throwIO $ UnavailableError err
        Right v -> case Aeson.fromJSON v of
          Aeson.Success p -> pure p
          Aeson.Error e -> liftIO . throwIO . InternalError . T.pack $ "bad proof payload: " ++ e
  accountLeaf <-
    maybe (notFound $ "no account at " ++ show addr ++ " in block " ++ show (number hdr)) pure $
      stpAccountLeaf proof
  storage <- zipWithM storageItem paths (stpStorage proof)
  pure
    StateProofResponse
      { sprBlockNumber = number hdr,
        sprBlockHash = bh,
        sprHeaderRLP = toHex . rlpSerialize . rlpEncode $ clearBlockSignatures hdr,
        sprSignatures = map (toHex . exportSignature) $ getBlockSignatures hdr,
        sprAddress = addr,
        sprAccountProof = map hex $ stpAccountProof proof,
        sprAccountLeaf = hex accountLeaf,
        sprStorage = storage
      }
  where
    headerByHash :: (GetReceipts m, MonadIO m) => Keccak256 -> m (Keccak256, BlockHeader)
    headerByHash bh =
      getBlockHeaderByHash bh
        >>= maybe (notFound $ "no block header for hash " ++ show bh) (pure . (bh,))

    -- A default (zero) value is deleted from the trie, so it has no leaf.
    storageItem path sp = case spValue sp of
      Nothing -> notFound $ "no value at storage path " ++ BC.unpack (unparsePath path)
      Just val -> pure $ StorageItemProof path (hex $ spTrieKey sp) (map hex $ spProof sp) (hex val)

    notFound :: MonadIO m => String -> m a
    notFound = liftIO . throwIO . CouldNotFind . T.pack

    hex = toHex . unHexData

-- | The node's co-located ethereum-jsonrpc service.
vmJsonRpcUrl :: String
vmJsonRpcUrl = "http://" ++ apiListenAddress (apiConfig ethConf) ++ ":" ++ show jsonRpcPort

toHex :: B.ByteString -> String
toHex bs = "0x" ++ BC.unpack (B16.encode bs)
