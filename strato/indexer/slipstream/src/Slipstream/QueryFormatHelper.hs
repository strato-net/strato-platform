-- library for all sql query formatting functions
{-# LANGUAGE OverloadedStrings #-}

module Slipstream.QueryFormatHelper where

import qualified Data.Aeson as Aeson
import qualified Data.Aeson.Key as AesonKey
import qualified Data.Map as Map
import qualified Data.Text as T
--import Slipstream.Data.Globals (TableName (..))

-- TODO: Refactor this type before someone external sees it
data TableName
  = IndexTableName
      { itCreator :: T.Text,
        itApplication :: T.Text,
        itContractName :: T.Text
      }
  | HistoryTableName -- technically the same as index, but logically different
      { htCreator :: T.Text,
        htApplication :: T.Text,
        htContractName :: T.Text
      }
  | EventTableName
      { etCreator :: T.Text,
        etApplication :: T.Text,
        etContractName :: T.Text,
        etEventName :: T.Text
      }
  | CollectionTableName
      { mtCreator :: T.Text,
        mtApplication :: T.Text,
        mtContractName :: T.Text,
        mtCollectionName :: T.Text
      }
  | EventCollectionTableName
      { ectCreator :: T.Text,
        ectApplication :: T.Text,
        ectContractName :: T.Text,
        ectEventName :: T.Text,
        ectCollectionName :: T.Text
      }
  | AbstractTableName
      { atCreator :: T.Text,
        atApplication :: T.Text,
        atContractName :: T.Text
      }
  deriving (Show, Eq, Ord)

type TableColumns = [T.Text]

tshow :: Show a => a -> T.Text
tshow = T.pack . show

csv :: [T.Text] -> T.Text
csv = T.intercalate ",\n    "

csv' :: [T.Text] -> T.Text
csv' = T.intercalate "dream,\n    "

wrap :: T.Text -> T.Text -> T.Text -> T.Text
wrap b e x = T.concat [b, x, e]

wrap1 :: T.Text -> T.Text -> T.Text
wrap1 t = wrap t t

wrapSingleQuotes :: T.Text -> T.Text
wrapSingleQuotes = wrap1 "\'"

wrapDoubleQuotes :: T.Text -> T.Text
wrapDoubleQuotes = wrap1 "\""

wrapParens :: T.Text -> T.Text
wrapParens = wrap "(" ")"

wrapAndEscape :: [T.Text] -> T.Text
wrapAndEscape = wrapParens . csv

wrapAndEscapeSingle :: [T.Text] -> T.Text
wrapAndEscapeSingle = wrapParens . csv . map wrapSingleQuotes

wrapAndEscapeDouble :: [T.Text] -> T.Text
wrapAndEscapeDouble = wrapParens . csv . map wrapDoubleQuotes

unwrapDoubleQuotes :: T.Text -> T.Text
unwrapDoubleQuotes = T.dropAround (== '"')

escapeSingleQuotes :: T.Text -> T.Text
escapeSingleQuotes = T.replace "\'" "\'\'"

escapeDoubleQuotes :: T.Text -> T.Text
escapeDoubleQuotes = T.replace "\"" "\\\""

escapeQuotes :: T.Text -> T.Text
escapeQuotes = escapeSingleQuotes . escapeDoubleQuotes

escapeUnderscores :: T.Text -> T.Text
escapeUnderscores = T.replace "_" "\\_"

tableSeparator :: T.Text
tableSeparator = "-"

tableNameToText :: TableName -> T.Text
tableNameToText (IndexTableName c a n) =
  let prefix
        | T.null c = ""
        | T.null a = c <> tableSeparator
        | otherwise = c <> tableSeparator <> a <> tableSeparator
   in prefix <> n
tableNameToText (CollectionTableName c a n m) =
  let prefix
        | T.null c = ""
        | T.null a = c <> tableSeparator
        | otherwise = c <> tableSeparator <> a <> tableSeparator
      contractAndCollection = n <> "-" <> m
   in prefix <> contractAndCollection
tableNameToText (HistoryTableName c a n) =
  let prefix
        | T.null c = ""
        | T.null a = c <> tableSeparator
        | otherwise = c <> tableSeparator <> a <> tableSeparator
   in "history@" <> prefix <> n
tableNameToText (EventTableName c a n e) =
  let prefix
        | T.null c = ""
        | T.null a = c <> tableSeparator
        | otherwise = c <> tableSeparator <> a <> tableSeparator
      contractAndEvent = n <> tableSeparator <> e
   in prefix <> contractAndEvent
tableNameToText (EventCollectionTableName c a n e m) =
  let prefix
        | T.null c = ""
        | T.null a = c <> tableSeparator
        | otherwise = c <> tableSeparator <> a <> tableSeparator
      contractEventAndCollection = n <> tableSeparator <> e <> tableSeparator <> m
   in prefix <> contractEventAndCollection
tableNameToText (AbstractTableName c a n) =
  let prefix
        | T.null c = ""
        | T.null a = c <> tableSeparator
        | otherwise = c <> tableSeparator <> a <> tableSeparator
   in prefix <> n

-- TODO: delete once marketplace uses new separator format everywhere
oldTableNameToText :: TableName -> T.Text
oldTableNameToText (EventTableName c a n e) =
  let prefix
        | T.null c = ""
        | T.null a = c <> tableSeparator
        | otherwise = c <> tableSeparator <> a <> tableSeparator
      contractAndEvent = n <> "." <> e
   in prefix <> contractAndEvent
oldTableNameToText t = tableNameToText t

tableNameToTextPostgres :: TableName -> T.Text
tableNameToTextPostgres = T.take 63 . tableNameToText -- max table name len in psql is 63 char

tableNameToSingleQuoteText :: TableName -> T.Text
tableNameToSingleQuoteText = wrapSingleQuotes . escapeQuotes . tableNameToTextPostgres

tableNameToDoubleQuoteText :: TableName -> T.Text
tableNameToDoubleQuoteText = wrapDoubleQuotes . escapeQuotes . tableNameToText

-- TODO: delete once marketplace uses new separator format everywhere
oldTableNameToDoubleQuoteText :: TableName -> T.Text
oldTableNameToDoubleQuoteText = wrapDoubleQuotes . escapeQuotes . oldTableNameToText

textToDoubleQuoteText :: T.Text -> T.Text
textToDoubleQuoteText =  wrapDoubleQuotes . escapeQuotes

removeSingleQuotes :: T.Text -> T.Text
removeSingleQuotes inputText =
  let str = T.unpack inputText
      -- Remove the single quotes from the string
      cleanedStr = filter (/= '\'') str
   in T.pack cleanedStr

aesonHelper :: Map.Map T.Text T.Text -> Map.Map Aeson.Key Aeson.Value
aesonHelper m = Map.fromList $ map (\(x, y) -> (AesonKey.fromText x, Aeson.toJSON $ removeSingleQuotes y)) (Map.toList m)

newtype MapWrapper = MapWrapper (Map.Map Aeson.Key Aeson.Value)

instance Aeson.ToJSON MapWrapper where
  toJSON (MapWrapper m) = Aeson.object (map (\(k, v) -> k Aeson..= v) (Map.toList m))
