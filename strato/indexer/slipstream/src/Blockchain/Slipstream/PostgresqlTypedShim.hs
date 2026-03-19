{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Blockchain.Slipstream.PostgresqlTypedShim
  ( -- types
    PGConnection
  , PGDatabase(..)
  , PGTlsMode(..)
  , pgQuery
  ) where

import           Data.Int (Int64)
import           Data.ByteString (ByteString)
import           Data.Pool
import           Network.Socket (HostName, ServiceName, SockAddr(..))
import           Database.Persist.Postgresql
import           Data.Text.Encoding (decodeUtf8)

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
  runSqlPool (rawExecuteCount (decodeUtf8 q) []) pool
