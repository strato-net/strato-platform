{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Strato.Lite.Cirrus where

import Control.Monad.IO.Class
import Data.Aeson (Value(..))
import qualified Data.Aeson as Aeson
import qualified Data.Aeson.Key as Aeson
import qualified Data.Aeson.KeyMap as Aeson
import qualified Data.Text as T
import qualified Data.Vector as V
import Data.Maybe (mapMaybe)
import Database.Persist.Sql
import Data.Conduit (runConduit, (.|))
import qualified Data.Conduit.List as CL
import Data.Acquire (with)

-- | Convert PersistValue to JSON Value
sqlDataToJson :: PersistValue -> Value
sqlDataToJson (PersistText t)       = String t
sqlDataToJson (PersistByteString b) = String (T.pack (show b))
sqlDataToJson (PersistInt64 i)      = Aeson.Number (fromIntegral i)
sqlDataToJson (PersistDouble d)     = Aeson.Number (realToFrac d)
sqlDataToJson (PersistRational r)   = Aeson.Number (fromRational r)
sqlDataToJson (PersistBool b)       = Aeson.Bool b
sqlDataToJson PersistNull           = Aeson.Null
sqlDataToJson other                 = String (T.pack (show other))

-- | Query a table dynamically and return JSON array of JSON objects
queryCirrus :: ConnectionPool -> T.Text -> IO Value
queryCirrus pool tableName = runSqlPool action pool
  where
    action = do
      -- 1. Get column names using PRAGMA (SQLite only)
      let pragmaQ = "PRAGMA table_info(" <> tableName <> ")"
      pragmaAcquire <- rawQueryRes pragmaQ []
      pragmaRows <- liftIO $
        with pragmaAcquire $ \src ->
          runConduit (src .| CL.consume)
      let cols = mapMaybe extractColName pragmaRows

      -- 2. Get all rows via Conduit
      let q = "SELECT * FROM \"" <> tableName <> "\""
      srcAcquire <- rawQueryRes q []
      rows <- liftIO $
        with srcAcquire $ \src ->
          runConduit (src .| CL.consume)

      -- 3. Convert each row to JSON object
      let rowToObject :: [PersistValue] -> Value
          rowToObject fields =
            Object . Aeson.fromList $
              zip (map Aeson.fromText cols) (map sqlDataToJson fields)

      pure . Array . V.fromList $ map rowToObject rows

    -- Extract column name from PRAGMA table_info result
    -- PRAGMA returns: cid, name, type, notnull, dflt_value, pk
    extractColName :: [PersistValue] -> Maybe T.Text
    extractColName (_cid : PersistText name : _type : _notnull : _dflt : _pk : _) = Just name
    extractColName _ = Nothing
