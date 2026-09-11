{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

-- | Rebuild, from a node's public read API, the mirror rows a contract
-- needs: its account row, its code by hash, all its storage rows, and the
-- node's best block as the local best block. The API serves the same
-- tables strato-indexer writes (@/eth/v1.2/account@, @/code/{hash}@,
-- @/storage@, @/block/last/1@), so this is the mirror without database
-- credentials, good enough to run the query VM against real contracts and
-- compare with the node's own VM.
module Blockchain.VmQuery.Import
  ( importFromNode,
  )
where

import Blockchain.DB.SQLDB
import Blockchain.Data.Block (blockBlockData)
import Blockchain.Data.BlockHeader (BlockHeader (..))
import Blockchain.Data.DataDefs
import Blockchain.Model.JsonBlock (AddressStateRef' (..), Block', bPrimeToB)
import Blockchain.Strato.Model.Address (Address (..))
import Blockchain.Strato.Model.Class (blockHeaderHash)
import Blockchain.Strato.Model.Keccak256 (Keccak256, hash, keccak256ToHex)
import Control.Monad (forM_, unless, when)
import Control.Monad.Logger (LogLevel (..), filterLogger, runStderrLoggingT)
import Control.Monad.Composable.SQL (runSQLMWith)
import qualified Data.Aeson as Aeson
import qualified Data.Aeson.KeyMap as KM
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import Data.IORef
import qualified Data.Set as S
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8, encodeUtf8)
import qualified Data.Vector as V
import Database.Persist ((==.))
import qualified Database.Persist as P
import Network.HTTP.Client (Manager, httpLbs, parseRequest, responseBody, responseStatus)
import Network.HTTP.Client.TLS (newTlsManager)
import Network.HTTP.Types (statusCode)
import SolidVM.Model.Storable (BasicValue (..), StoragePath, basicParse, parsePath)
import Text.Printf (printf)

get :: Manager -> String -> IO BL.ByteString
get manager url = do
  req <- parseRequest url
  resp <- httpLbs req manager
  let code = statusCode (responseStatus resp)
  when (code /= 200) $ ioError (userError (url ++ " returned HTTP " ++ show code))
  pure (responseBody resp)

decodeOrDie :: Aeson.FromJSON a => String -> BL.ByteString -> IO a
decodeOrDie what body = case Aeson.eitherDecode body of
  Right v -> pure v
  Left e -> ioError (userError (what ++ ": " ++ e ++ " in " ++ take 200 (BC.unpack (BL.toStrict body))))

-- | Storage rows come as @[{"key": path, "value": rendered}]@; the value
-- text is what the mirror holds, parsed the way the mirror parses it.
parseStorageRows :: BL.ByteString -> IO [(StoragePath, BasicValue)]
parseStorageRows body = do
  v <- decodeOrDie "storage" body
  case v of
    Aeson.Array items -> pure . concat . V.toList $ V.map row items
    _ -> ioError (userError "storage: expected an array")
  where
    row (Aeson.Object o) = case (KM.lookup "key" o, KM.lookup "value" o) of
      (Just (Aeson.String k), Just (Aeson.String val)) -> case (parsePath (BC.pack (T.unpack k)), basicParse (T.unpack val)) of
        (Right path, Just bv) -> [(path, bv)]
        _ -> []
      _ -> []
    row _ = []

-- | @address(<40 hex>)@ as the mirror renders an address-typed slot.
addressValue :: BasicValue -> Maybe Address
addressValue (BAddress a) = Just a
addressValue _ = Nothing

importFromNode :: SQLDB -> String -> [Address] -> IO ()
importFromNode db nodeUrl targets = do
  manager <- newTlsManager
  let api = nodeUrl ++ "/strato-api/eth/v1.2"
      runDb = runStderrLoggingT . filterLogger (\_ lvl -> lvl >= LevelWarn) . runSQLMWith db
  -- Best block first: everything below is read after it, so a call on the
  -- imported rows sees state at least as new as this header.
  blocks <- get manager (api ++ "/block/last/1") >>= decodeOrDie "block/last/1" :: IO [Block']
  case blocks of
    [] -> ioError (userError "block/last/1 returned no block")
    (b : _) -> do
      let header = blockBlockData (bPrimeToB b)
      runDb . sqlQueryWriter $ do
        existing <- P.selectFirst [BlockDataRefHash ==. blockHeaderHash header] []
        case existing of
          Just _ -> pure ()
          Nothing -> do
            _ <- P.insert (headerToRow header)
            pure ()
      printf "best block %d (%s) imported\n" (number header) (take 12 (keccak256ToHex (blockHeaderHash header)))

  seen <- newIORef S.empty
  queue <- newIORef targets
  let loop = do
        q <- readIORef queue
        case q of
          [] -> pure ()
          (addr : rest) -> do
            writeIORef queue rest
            done <- readIORef seen
            unless (S.member addr done) $ do
              modifyIORef' seen (S.insert addr)
              importOne addr
            loop
      importOne addr = do
        accounts <- get manager (api ++ "/account?address=" ++ show addr) >>= decodeOrDie "account" :: IO [AddressStateRef']
        case accounts of
          [] -> printf "%s: no account row on the node, skipped\n" (show addr)
          (AddressStateRef' row : _) -> do
            -- code: the API serves the stored text as JSON, so a plain
            -- source arrives as a JSON string (quoted, escaped) and a
            -- multi-file collection as the JSON array it is stored as. The
            -- keccak of the decoded bytes must be the account's code hash.
            forM_ (addressStateRefCodeHash row) $ \h -> do
              body <- get manager (api ++ "/code/" ++ keccak256ToHex h)
              let bytes = case Aeson.decode body of
                    Just (Aeson.String t) -> encodeUtf8 t
                    _ -> BL.toStrict body
              when (hash bytes /= h) $ printf "%s: WARNING code from the node hashes to %s, not %s\n" (show addr) (keccak256ToHex (hash bytes)) (keccak256ToHex h)
              runDb . sqlQueryWriter $ do
                _ <- P.insertBy (CodeRef h (decodeUtf8 bytes))
                pure ()
            rows <- get manager (api ++ "/storage?address=" ++ show addr ++ "&limit=1000000") >>= parseStorageRows
            runDb . sqlQueryWriter $ do
              mExisting <- P.getBy (UniqueAddress addr)
              sid <- case mExisting of
                Just (P.Entity k _) -> do
                  P.deleteWhere [StorageAddressStateRefId ==. k]
                  P.replace k row
                  pure k
                Nothing -> P.insert row
              forM_ rows $ \(path, bv) -> P.insert (Storage sid path bv)
            printf "%s: %s, %d storage rows\n" (show addr) (maybe "no contract" id (addressStateRefContractName row)) (length rows)
            -- A proxy's logic contract is where the code and most reads are.
            forM_ [a | (path, bv) <- rows, isLogicContract path, Just a <- [addressValue bv]] $ \logic -> do
              printf "  follows proxy to %s\n" (show logic)
              modifyIORef' queue (++ [logic])
  loop
  where
    isLogicContract path = Right path == parsePath "logicContract"

-- | The row strato-indexer writes for a header, without the validator and
-- signature side tables a call does not need.
headerToRow :: BlockHeader -> BlockDataRef
headerToRow h =
  BlockDataRef
    { blockDataRefParentHash = parentHash h,
      blockDataRefUnclesHash = zeroHash,
      blockDataRefCoinbase = Address 0,
      blockDataRefStateRoot = stateRoot h,
      blockDataRefTransactionsRoot = transactionsRoot h,
      blockDataRefReceiptsRoot = receiptsRoot h,
      blockDataRefLogBloom = logsBloom h,
      blockDataRefDifficulty = 0,
      blockDataRefNumber = number h,
      blockDataRefGasLimit = 100000000,
      blockDataRefGasUsed = 0,
      blockDataRefTimestamp = timestamp h,
      blockDataRefExtraData = extraData h,
      blockDataRefNonce = 0,
      blockDataRefMixHash = zeroHash,
      blockDataRefHash = blockHeaderHash h,
      blockDataRefPowVerified = True,
      blockDataRefIsConfirmed = True,
      blockDataRefVersion = case h of
        BlockHeaderV3 {} -> 3
        BlockHeaderV2 {} -> 2
        _ -> 1,
      blockDataRefProposalRound = case h of
        BlockHeaderV3 {proposalRound = r} -> Just r
        _ -> Nothing
    }
  where
    zeroHash :: Keccak256
    zeroHash = hash ""
