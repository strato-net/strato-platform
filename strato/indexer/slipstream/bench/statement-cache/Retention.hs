{-# LANGUAGE OverloadedStrings #-}

import Blockchain.Slipstream.PostgresqlTypedShim (pgQuery)
import Control.Monad (forM_)
import Control.Monad.Logger (runNoLoggingT)
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import Data.Pool (withResource)
import qualified Database.Persist.Postgresql as Postgres
import Database.Persist.SqlBackend.Internal (connStmtMap)
import Database.Persist.SqlBackend.Internal.StatementCache (statementCacheSize)
import GHC.Stats
import System.Environment (getArgs)
import System.Mem (performMajorGC)

main :: IO ()
main = do
  args <- getArgs
  (connectionString, statementCount, payloadBytes) <-
    case args of
      [connectionString', statementCount', payloadBytes'] ->
        pure (connectionString', read statementCount', read payloadBytes')
      _ -> fail "usage: statement-cache-retention CONNECTION STATEMENT_COUNT PAYLOAD_BYTES"

  pool <- runNoLoggingT $ Postgres.createPostgresqlPool (BC.pack connectionString) 1
  _ <- pgQuery pool "CREATE TEMPORARY TABLE cache_probe (id integer PRIMARY KEY)"
  forM_ [1 .. statementCount] $ \statementNumber -> do
    let query =
          "INSERT INTO cache_probe (id) VALUES ("
            <> BC.pack (show statementNumber)
            <> ") /*"
            <> B.replicate payloadBytes 120
            <> "*/"
    _ <- pgQuery pool query
    if statementNumber `mod` 50 == 0 || statementNumber == statementCount
      then report pool statementNumber
      else pure ()

report :: Postgres.ConnectionPool -> Int -> IO ()
report pool statementNumber = do
  performMajorGC
  cacheEntries <- withResource pool $ statementCacheSize . connStmtMap
  statsEnabled <- getRTSStatsEnabled
  liveBytes <-
    if statsEnabled
      then gcdetails_live_bytes . gc <$> getRTSStats
      else pure 0
  putStrLn . unwords $
    [ "statements=" <> show statementNumber,
      "cache_entries=" <> show cacheEntries,
      "live_bytes=" <> show liveBytes
    ]
