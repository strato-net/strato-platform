-- library for all sql query formatting functions
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Slipstream.QueryFormatHelper where

import qualified Data.Aeson as Aeson
import qualified Data.Aeson.Key as AesonKey
import qualified Data.Map as Map
import Data.Text (Text)
import qualified Data.Text as T

data SqlType = SqlBool | SqlDecimal | SqlText | SqlJsonb | SqlSerial deriving (Eq, Ord, Show)

sqlTypePostgres :: SqlType -> Text
sqlTypePostgres SqlBool    = "bool"
sqlTypePostgres SqlDecimal = "decimal"
sqlTypePostgres SqlText    = "text"
sqlTypePostgres SqlJsonb   = "jsonb"
sqlTypePostgres SqlSerial  = "serial"

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

type TableColumns = [(T.Text, SqlType)]

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

wrapEscapeSingle :: T.Text -> T.Text
wrapEscapeSingle = wrapSingleQuotes . escapeSingleQuotes

wrapEscapeDouble :: T.Text -> T.Text
wrapEscapeDouble = wrapDoubleQuotes . escapeDoubleQuotes

wrapAndEscapeSingle :: [T.Text] -> T.Text
wrapAndEscapeSingle = wrapParens . csv . map wrapEscapeSingle

wrapAndEscapeDouble :: [T.Text] -> T.Text
wrapAndEscapeDouble = wrapParens . csv . map wrapEscapeDouble

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

indexedEventTableName :: TableName -> TableName
indexedEventTableName (EventTableName c a n e) = EventTableName ("indexed@" <> c) a n e
indexedEventTableName tn = tn

tableShortName :: TableName -> T.Text
tableShortName (IndexTableName _ _ n) = n
tableShortName (CollectionTableName _ _ n m) = n <> "-" <> m
tableShortName (HistoryTableName _ _ n) = "history@" <> n
tableShortName (EventTableName _ _ n e) = n <> "-" <> e
tableShortName (EventCollectionTableName _ _ n e m) = n <> "-" <> e <> "-" <> m
tableShortName (AbstractTableName _ _ n) = n

-- discard app if org is null
constructTableNameParameters :: Text -> Text -> Text -> (Text, Text, Text)
constructTableNameParameters crtr app contract
  | T.null crtr = ("", "", contract)
  | app == contract = (crtr, "", contract)
  | otherwise = (crtr, app, contract)

historyTableName :: Text -> Text -> Text -> TableName
historyTableName creator a n = uncurry3 HistoryTableName $ constructTableNameParameters creator a n

indexTableName :: Text -> Text -> Text -> TableName
indexTableName creator a n = uncurry3 IndexTableName $ constructTableNameParameters creator a n

collectionTableName :: Text -> Text -> Text -> Text -> TableName
collectionTableName creator a n m =
  let (c', a', n') = constructTableNameParameters creator a n
   in CollectionTableName c' a' n' m

eventTableName :: Text -> Text -> Text -> Text -> TableName
eventTableName creator a n e =
  let (c', a', n') = constructTableNameParameters creator a n
   in EventTableName c' a' n' e

eventCollectionTableName :: Text -> Text -> Text -> Text -> Text -> TableName
eventCollectionTableName creator a n e m =
  let (c', a', n') = constructTableNameParameters creator a n
   in EventCollectionTableName c' a' n' e m

uncurry3 :: (a -> b -> c -> d) -> (a, b, c) -> d
uncurry3 f (x, y, z) = f x y z

tableNameCreator :: TableName -> T.Text
tableNameCreator (IndexTableName c _ _) = c
tableNameCreator (CollectionTableName c _ _ _) = c
tableNameCreator (HistoryTableName c _ _) = c
tableNameCreator (EventTableName c _ _ _) = c
tableNameCreator (EventCollectionTableName c _ _ _ _) = c
tableNameCreator (AbstractTableName c _ _) = c

tableNameApplication :: TableName -> T.Text
tableNameApplication (IndexTableName _ a _) = a
tableNameApplication (CollectionTableName _ a _ _) = a
tableNameApplication (HistoryTableName _ a _) = a
tableNameApplication (EventTableName _ a _ _) = a
tableNameApplication (EventCollectionTableName _ a _ _ _) = a
tableNameApplication (AbstractTableName _ a _) = a

tableNameContractName :: TableName -> T.Text
tableNameContractName (IndexTableName _ _ n) = n
tableNameContractName (CollectionTableName _ _ n _) = n
tableNameContractName (HistoryTableName _ _ n) = n
tableNameContractName (EventTableName _ _ n _) = n
tableNameContractName (EventCollectionTableName _ _ n _ _) = n
tableNameContractName (AbstractTableName _ _ n) = n

tableNameCollectionName :: TableName -> T.Text
tableNameCollectionName (CollectionTableName _ _ _ c) = c
tableNameCollectionName (EventCollectionTableName _ _ _ _ c) = c
tableNameCollectionName _ = ""

tableNameEventName :: TableName -> T.Text
tableNameEventName (EventTableName _ _ _ e) = e
tableNameEventName (EventCollectionTableName _ _ _ e _) = e
tableNameEventName _ = ""

tableNameToTextPostgres :: TableName -> T.Text
tableNameToTextPostgres = T.take 63 . tableNameToText -- max table name len in psql is 63 char

tableNameToSingleQuoteText :: TableName -> T.Text
tableNameToSingleQuoteText = wrapSingleQuotes . escapeQuotes . tableNameToTextPostgres

tableNameToDoubleQuoteText :: TableName -> T.Text
tableNameToDoubleQuoteText = wrapDoubleQuotes . escapeQuotes . tableNameToText

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
