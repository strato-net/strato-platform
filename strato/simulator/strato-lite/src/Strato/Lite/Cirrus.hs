{-# LANGUAGE OverloadedStrings #-}

module Strato.Lite.Cirrus (queryCirrus) where

import Database.SQLite.Simple
import qualified Data.ByteString.Base16 as B16
import qualified Data.Text as T
import Data.Text.Encoding
import Data.Aeson
import Data.Aeson.Key
import Data.Aeson.KeyMap (fromMap)
import qualified Data.Vector as V
import qualified Data.Map.Strict as Map

-- | Query a dynamic table and return a JSON array of JSON objects
queryCirrus :: FilePath -> T.Text -> IO Value
queryCirrus dbPath tableName = do
  conn <- open dbPath
  rows <- query_ conn $ Query $ "SELECT * FROM \"" <> tableName <> "\""

  -- Get column names
  let q = Query $ "SELECT * FROM \"" <> tableName <> "\" LIMIT 1"
  cols <- withStatement conn q $ \stmt -> do
    colCount <- columnCount stmt
    traverse (columnName stmt) $ enumFromTo 0 (colCount - 1)

  let rowToMap :: [SQLData] -> Value
      rowToMap fields = Object . fromMap . Map.fromList $ zip (fromText <$> cols) (sqlDataToJson <$> fields)

  pure . Array . V.fromList $ rowToMap <$> rows

-- | Convert sqlite-simple SQLData to Aeson Value
sqlDataToJson :: SQLData -> Value
sqlDataToJson (SQLInteger i) = Number $ fromIntegral i
sqlDataToJson (SQLFloat f)   = Number $ realToFrac f
sqlDataToJson (SQLText t)    = String t
sqlDataToJson (SQLBlob b)    = String . decodeUtf8 $ B16.encode b
sqlDataToJson SQLNull        = Null