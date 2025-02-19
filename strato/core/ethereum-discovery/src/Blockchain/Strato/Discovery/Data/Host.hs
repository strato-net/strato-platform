{-# LANGUAGE GeneralizedNewtypeDeriving #-}

module Blockchain.Strato.Discovery.Data.Host where

import Data.IP
import Data.String
import Data.Text (Text)
import qualified Data.Text as T
import qualified Database.Persist.Postgresql as SQL
import Text.Format
import Text.Read

newtype Host = Host Text deriving (Show, Read, Eq, Ord, IsString, SQL.PersistField, SQL.PersistFieldSql)

instance Format Host where
  format (Host v) = T.unpack v

hostToString :: Host -> String
hostToString (Host v) = T.unpack v

isIP :: Host -> Bool
isIP v =
  case readMaybe $ hostToString v :: Maybe IP of
    Nothing -> False
    Just _ -> True

