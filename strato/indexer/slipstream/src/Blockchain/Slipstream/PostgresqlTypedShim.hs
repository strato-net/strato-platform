{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
module Blockchain.Slipstream.PostgresqlTypedShim
  ( -- types
    PGConnection
  , PGDatabase(..)
  , PGTlsMode(..)
  , PGTlsValidateMode(..)
  , SignedCertificate(..)
  , MessageFields
    -- connect/disconnect
  , pgConnect
  , pgDisconnect
    -- queries
  , pgQuery, pgQuery_, pgExecute, pgExecute_, pgWithTransaction
    -- optional BS connect
  , pgConnectBS
  ) where

import           Data.Int (Int64)
import           Data.ByteString (ByteString)
import qualified Data.ByteString.Char8 as B
import qualified Database.PostgreSQL.Simple as S
import           Database.PostgreSQL.Simple.Types (Query(..))   -- constructor for raw
import           Network.Socket (HostName, ServiceName, SockAddr(..))
import           System.FilePath (takeDirectory, takeFileName)
import           Data.List (stripPrefix)

-- libpq-backed connection
type PGConnection = S.Connection

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

-- === Connect/Disconnect =====================================================

pgConnect :: PGDatabase -> IO PGConnection
pgConnect db = S.connectPostgreSQL (toConnString db)

pgConnectBS :: ByteString -> IO PGConnection
pgConnectBS = S.connectPostgreSQL

pgDisconnect :: PGConnection -> IO ()
pgDisconnect = S.close

-- === Queries/Exec ===========================================================

pgQuery :: PGConnection -> ByteString -> IO Int64
pgQuery conn q = S.execute_ conn (Query q)

pgQuery_ :: PGConnection -> ByteString -> IO Int64
pgQuery_ conn q = S.execute_ conn (Query q)

pgExecute :: PGConnection -> ByteString -> IO Int64
pgExecute conn q = S.execute_ conn (Query q)

pgExecute_ :: PGConnection -> ByteString -> IO Int64
pgExecute_ conn q = S.execute_ conn (Query q)

pgWithTransaction :: PGConnection -> IO a -> IO a
pgWithTransaction conn action = S.withTransaction conn action

-- === internals: build a libpq connstring ====================================

toConnString :: PGDatabase -> ByteString
toConnString PGDatabase{..} =
  B.unwords . map renderKV $
       connAddrKVs pgDBAddr
    ++ [ ("dbname",   pgDBName)
       , ("user",     pgDBUser)
       , ("password", pgDBPass)
       ]
    ++ tlsKVs pgDBTLS
    ++ pgDBParams
  where
    tlsKVs TlsDisabled           = [("sslmode","disable")]
    tlsKVs TlsNoValidate         = [("sslmode","require")]
    tlsKVs (TlsValidate m _cert) = [("sslmode", case m of
                                                TlsValidateCA   -> "verify-ca"
                                                TlsValidateFull -> "verify-full")]
    renderKV (k,v)
      | needsQuote v = B.concat [k,"='",esc v,"'"]
      | otherwise    = B.concat [k,"=",v]
    needsQuote v = B.any (`elem` (" \t\r\n'\\\"" :: String)) v
    esc = B.concatMap (\c -> if c == '\'' || c == '\\' then B.pack [c,c] else B.singleton c)

connAddrKVs :: Either (HostName, ServiceName) SockAddr -> [(ByteString, ByteString)]
connAddrKVs (Left (h,svc)) = [("host", B.pack h), ("port", B.pack svc)]
connAddrKVs (Right sa) = case sa of
  SockAddrUnix path ->
    let dir  = takeDirectory path
        file = takeFileName path
        mPort = do
          rest <- stripPrefix ".s.PGSQL." file
          if all (`elem` ['0'..'9']) rest then Just rest else Nothing
        port = maybe "5432" id mPort
    in [("host", B.pack dir), ("port", B.pack port)]
  _ -> []
