{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeOperators #-}

module Control.Monad.Composable.CodeDB
  ( CodeDBM,
    HasCodeDBAccess,
    runCodeDBM,
    lookupCodeCollection,
    lookupCodeHash,
    queryEvents,
    queryEventsByTxHash,
    EventRow (..),
  )
where

import BlockApps.Logging (runNoLoggingT)
import Blockchain.DB.CodeDB (DBCode)
import Blockchain.DB.SQLDB (SQLDB (..), CirrusDB (..))
import Blockchain.Data.AddressStateDB (AddressState)
import Blockchain.Data.DataDefs (AddressStateRef (..), CodeRef (..), EntityField (..))
import Blockchain.EthConf (connStr, cirrusConnStr)
import Blockchain.SolidVM.CodeCollectionDB (codeCollectionFromHash)
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.Keccak256 (Keccak256)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Composable.Base
import Control.Monad.IO.Class
import Control.Monad.IO.Unlift
import Control.Monad.Reader
import Control.Monad.Trans.Resource (ResourceT, runResourceT)
import Control.Exception (try, SomeException)
import Data.Aeson (Value, decode)
import Data.IORef
import Data.List (intercalate)
import qualified Data.Map.Strict as Map
import Data.Maybe (listToMaybe)
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as Text
import qualified Data.ByteString.Lazy as BL
import qualified Database.Esqueleto.Legacy as E
import qualified Database.Persist.Postgresql as PSQL
import qualified Database.Persist.Sql as SQL
import SolidVM.Model.CodeCollection (CodeCollection)
import System.IO.Unsafe (unsafePerformIO)

data CodeDBEnv = CodeDBEnv
  { codeDBPool  :: SQLDB
  , cirrusPool  :: CirrusDB
  }

type CodeDBM = ReaderT CodeDBEnv

type HasCodeDBAccess m = (MonadIO m, MonadUnliftIO m, AccessibleEnv CodeDBEnv m)

instance {-# OVERLAPPING #-} Monad m => AccessibleEnv SQLDB (ReaderT CodeDBEnv m) where
  accessEnv = asks codeDBPool

instance {-# OVERLAPPING #-} Monad m => AccessibleEnv CirrusDB (ReaderT CodeDBEnv m) where
  accessEnv = asks cirrusPool

instance {-# OVERLAPPING #-} (Keccak256 `A.Alters` DBCode) (ReaderT CodeDBEnv IO) where
  lookup _ k = fmap (fmap Text.encodeUtf8) $ lookupCode k
  insert _ _ _ = error "CodeDB monad: insert not supported"
  delete _ _ = error "CodeDB monad: delete not supported"

instance {-# OVERLAPPING #-} A.Selectable FilePath (Either String String) (ReaderT CodeDBEnv IO) where
  select _ _ = pure Nothing

instance {-# OVERLAPPING #-} A.Selectable Address AddressState (ReaderT CodeDBEnv IO) where
  select _ _ = pure Nothing

globalCodeDBEnv :: IORef CodeDBEnv
globalCodeDBEnv = unsafePerformIO $ do
  sPool <- runNoLoggingT $ PSQL.createPostgresqlPool connStr 5
  cPool <- runNoLoggingT $ PSQL.createPostgresqlPool cirrusConnStr 5
  newIORef $ CodeDBEnv (SQLDB sPool) (CirrusDB cPool)
{-# NOINLINE globalCodeDBEnv #-}

runCodeDBM :: MonadIO m => CodeDBM IO a -> m a
runCodeDBM f = liftIO $ do
  env <- readIORef globalCodeDBEnv
  runReaderT f env

stratoQuery :: HasCodeDBAccess m => SQL.SqlPersistT (ResourceT m) a -> m a
stratoQuery q = do
  env <- accessEnv
  runResourceT $ SQL.runSqlPool q (unSQLDB $ codeDBPool env)

cirrusQuery :: (MonadUnliftIO m, AccessibleEnv CirrusDB m) => SQL.SqlPersistT (ResourceT m) a -> m a
cirrusQuery q = do
  env <- accessEnv
  runResourceT $ SQL.runSqlPool q (unCirrusDB env)

lookupCode :: HasCodeDBAccess m => Keccak256 -> m (Maybe Text)
lookupCode cHash =
  fmap (listToMaybe . map (codeRefCode . E.entityVal)) . stratoQuery . E.select $
    E.from $ \codeRef -> do
      E.where_ (codeRef E.^. CodeRefCodeHash E.==. E.val cHash)
      return codeRef

lookupCodeCollection :: Keccak256 -> CodeDBM IO (Maybe CodeCollection)
lookupCodeCollection cHash = do
  result <- liftIO . try $ runReaderT (codeCollectionFromHash False False cHash) =<< readIORef globalCodeDBEnv
  case result of
    Right cc -> return (Just cc)
    Left (_ :: SomeException) -> return Nothing

lookupCodeHash :: Address -> CodeDBM IO (Maybe Keccak256)
lookupCodeHash addr = do
  rows <- stratoQuery . E.select $
    E.from $ \asr -> do
      E.where_ (asr E.^. AddressStateRefAddress E.==. E.val addr)
      return asr
  return $ listToMaybe rows >>= addressStateRefCodeHash . E.entityVal

data EventRow = EventRow
  { erAddress           :: Text
  , erBlockHash         :: Text
  , erTransactionHash   :: Text
  , erBlockNumber       :: Text
  , erTransactionSender :: Text
  , erEventIndex        :: Int
  , erEventName         :: Text
  , erAttributes        :: Map.Map Text Value
  } deriving (Show)

-- | The Cirrus @event@ table stores @address@ without a @0x@ prefix, so any
-- prefix on the address filter is stripped before comparison (mirroring
-- 'queryEventsByTxHash').
queryEvents :: Maybe Text -> Integer -> Integer -> Maybe Text -> Int -> CodeDBM IO [EventRow]
queryEvents mAddr0 fromBlock toBlock mEventName limit = do
  let mAddr = fmap (\a -> if T.isPrefixOf "0x" a then T.drop 2 a else a) mAddr0
      addressFilter = case mAddr of
        Just _addr -> ["LOWER(address) = LOWER(?)"]
        Nothing -> []
      eventNameFilter = case mEventName of
        Just _eventName -> ["event_name = ?"]
        Nothing -> []
      blockFilters =
        [ "CAST(block_number AS numeric) >= ?",
          "CAST(block_number AS numeric) <= ?"
        ]
      baseQuery =
        "SELECT address, block_hash, transaction_hash, block_number, transaction_sender, event_index::int, event_name, attributes::text \
        \FROM \"event\" WHERE "
          ++ intercalate " AND " (addressFilter ++ eventNameFilter ++ blockFilters)
          ++ " ORDER BY CAST(block_number AS numeric), event_index LIMIT ?"
      params =
        maybe [] (pure . SQL.PersistText) mAddr
          ++ maybe [] (pure . SQL.PersistText) mEventName
          ++ [ SQL.PersistInt64 (fromIntegral fromBlock),
               SQL.PersistInt64 (fromIntegral toBlock),
               SQL.PersistInt64 (fromIntegral limit)
             ]
  rows <- cirrusQuery $ SQL.rawSql (T.pack baseQuery) params
  return $ map toEventRow rows

-- | All events emitted by a single transaction, ordered by event index. The
-- Cirrus @event@ table stores @transaction_hash@ without a @0x@ prefix, so any
-- prefix on the argument is stripped before comparison.
queryEventsByTxHash :: Text -> Int -> CodeDBM IO [EventRow]
queryEventsByTxHash txHash limit = do
  let norm = if T.isPrefixOf "0x" txHash then T.drop 2 txHash else txHash
      q =
        "SELECT address, block_hash, transaction_hash, block_number, transaction_sender, event_index::int, event_name, attributes::text \
        \FROM \"event\" WHERE LOWER(transaction_hash) = LOWER(?) ORDER BY event_index LIMIT ?"
      params = [SQL.PersistText norm, SQL.PersistInt64 (fromIntegral limit)]
  rows <- cirrusQuery $ SQL.rawSql (T.pack q) params
  return $ map toEventRow rows

toEventRow :: (SQL.Single Text, SQL.Single Text, SQL.Single Text, SQL.Single Text, SQL.Single Text, SQL.Single Int, SQL.Single Text, SQL.Single Text) -> EventRow
toEventRow (SQL.Single addr, SQL.Single bHash, SQL.Single txHash, SQL.Single bNum, SQL.Single txSender, SQL.Single eIdx, SQL.Single eName, SQL.Single attrsText) =
  EventRow addr bHash txHash bNum txSender eIdx eName attrs
  where
    attrs = case decode (BL.fromStrict $ Text.encodeUtf8 attrsText) of
      Just m  -> m
      Nothing -> Map.empty
