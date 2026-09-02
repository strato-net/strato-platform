{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Blockchain.Slipstream.PostgresqlTypedShim
  ( -- types
    PGConnection
  , PGDatabase(..)
  , PGTlsMode(..)
  , pgQuery
  , withStatementCacheCleanup
  ) where

import           Control.Monad.IO.Class (liftIO)
import           Control.Monad.Trans.Reader (ask)
import           Data.Int (Int64)
import           Data.ByteString (ByteString)
import           Data.Pool
import           Network.Socket (HostName, ServiceName, SockAddr(..))
import           Database.Persist.Postgresql
import           Database.Persist.SqlBackend.Internal (connStmtMap)
import           Database.Persist.SqlBackend.Internal.StatementCache (statementCacheClear)
import           Data.Text.Encoding (decodeUtf8)
import           UnliftIO (MonadUnliftIO, finally)

-- libpq-backed connection
--type PGConnection = S.Connection
type PGConnection = Pool SqlBackend

-- keep names compatible with postgresql-typed
type MessageFields = [(ByteString, ByteString)]
data PGTlsValidateMode = TlsValidateFull | TlsValidateCA deriving (Eq, Show)
data SignedCertificate = SignedCertificate deriving (Eq, Show)
data PGTlsMode
  = TlsDisabled
  | TlsNoValidate
  | TlsValidate PGTlsValidateMode SignedCertificate
  deriving (Eq, Show)

data PGDatabase = PGDatabase
  { pgDBAddr       :: Either (HostName, ServiceName) SockAddr
  , pgDBName       :: ByteString
  , pgDBUser       :: ByteString
  , pgDBPass       :: ByteString
  , pgDBParams     :: [(ByteString, ByteString)]
  , pgDBDebug      :: Bool
  , pgDBLogMessage :: MessageFields -> IO ()
  , pgDBTLS        :: PGTlsMode
  }

pgQuery :: PGConnection -> ByteString -> IO Int64
pgQuery pool q =
  runSqlPool
    (withStatementCacheCleanup $ rawExecuteCount (decodeUtf8 q) [])
    pool

withStatementCacheCleanup :: MonadUnliftIO m => SqlPersistT m a -> SqlPersistT m a
withStatementCacheCleanup action = do
  backend <- ask
  action `finally` liftIO (statementCacheClear $ connStmtMap backend)
