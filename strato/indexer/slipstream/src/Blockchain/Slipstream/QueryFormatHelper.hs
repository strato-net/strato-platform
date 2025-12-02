-- library for all sql query formatting functions
{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Slipstream.QueryFormatHelper where

import qualified Data.Aeson as Aeson
import qualified Data.Aeson.Key as AesonKey
import qualified Data.Map as Map
import Data.Text (Text)
import qualified Data.Text as T

data SqlType = SqlBool | SqlDecimal | SqlText | SqlJsonb | SqlTimestamp | SqlSerial deriving (Eq, Ord, Show)

sqlTypePostgres :: SqlType -> Text
sqlTypePostgres SqlBool      = "bool"
sqlTypePostgres SqlDecimal   = "decimal"
sqlTypePostgres SqlText      = "text"
sqlTypePostgres SqlJsonb     = "jsonb"
sqlTypePostgres SqlTimestamp = "timestamp"
sqlTypePostgres SqlSerial    = "serial"

-- TODO: Refactor this type before someone external sees it
data TableName
  = IndexTableName
      { itCreator :: T.Text,
        itContractName :: T.Text
      }
  | HistoryTableName -- technically the same as index, but logically different
      { htCreator :: T.Text,
        htContractName :: T.Text
      }
  | EventTableName
      { etCreator :: T.Text,
        etContractName :: T.Text,
        etEventName :: T.Text
      }
  | CollectionTableName
      { mtCreator :: T.Text,
        mtContractName :: T.Text,
        mtCollectionName :: T.Text
      }
  | EventCollectionTableName
      { ectCreator :: T.Text,
        ectContractName :: T.Text,
        ectEventName :: T.Text,
        ectCollectionName :: T.Text
      }
  | AbstractTableName
      { atCreator :: T.Text,
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
tableNameToText (IndexTableName c n) =
  let prefix
        | T.null c = ""
        | otherwise = c <> tableSeparator
   in prefix <> n
tableNameToText (CollectionTableName c n m) =
  let prefix
        | T.null c = ""
        | otherwise = c <> tableSeparator
      contractAndCollection = n <> "-" <> m
   in prefix <> contractAndCollection
tableNameToText (HistoryTableName c n) =
  let prefix
        | T.null c = ""
        | otherwise = c <> tableSeparator
   in "history@" <> prefix <> n
tableNameToText (EventTableName c n e) =
  let prefix
        | T.null c = ""
        | otherwise = c <> tableSeparator
      contractAndEvent = n <> tableSeparator <> e
   in prefix <> contractAndEvent
tableNameToText (EventCollectionTableName c n e m) =
  let prefix
        | T.null c = ""
        | otherwise = c <> tableSeparator
      contractEventAndCollection = n <> tableSeparator <> e <> tableSeparator <> m
   in prefix <> contractEventAndCollection
tableNameToText (AbstractTableName c n) =
  let prefix
        | T.null c = ""
        | otherwise = c <> tableSeparator
   in prefix <> n

indexedEventTableName :: TableName -> TableName
indexedEventTableName (EventTableName c n e) = EventTableName ("indexed@" <> c) n e
indexedEventTableName tn = tn

tableShortName :: TableName -> T.Text
tableShortName (IndexTableName _ n) = n
tableShortName (CollectionTableName _ n m) = n <> "-" <> m
tableShortName (HistoryTableName _ n) = "history@" <> n
tableShortName (EventTableName _ n e) = n <> "-" <> e
tableShortName (EventCollectionTableName _ n e m) = n <> "-" <> e <> "-" <> m
tableShortName (AbstractTableName _ n) = n

-- discard app if org is null
constructTableNameParameters :: Text -> Text -> (Text, Text)
constructTableNameParameters crtr contract
  | T.null crtr = ("", contract)
  | otherwise = (crtr, contract)

historyTableName :: Text -> Text -> TableName
historyTableName creator n = uncurry HistoryTableName $ constructTableNameParameters creator n

indexTableName :: Text -> Text -> TableName
indexTableName creator n = uncurry IndexTableName $ constructTableNameParameters creator n

collectionTableName :: Text -> Text -> Text -> TableName
collectionTableName creator n m =
  let (c', n') = constructTableNameParameters creator n
   in CollectionTableName c' n' m

eventTableName :: Text -> Text -> Text -> TableName
eventTableName creator n e =
  let (c', n') = constructTableNameParameters creator n
   in EventTableName c' n' e

eventCollectionTableName :: Text -> Text -> Text -> Text -> TableName
eventCollectionTableName creator n e m =
  let (c', n') = constructTableNameParameters creator n
   in EventCollectionTableName c' n' e m

uncurry3 :: (a -> b -> c -> d) -> (a, b, c) -> d
uncurry3 f (x, y, z) = f x y z

tableNameCreator :: TableName -> T.Text
tableNameCreator (IndexTableName c _) = c
tableNameCreator (CollectionTableName c _ _) = c
tableNameCreator (HistoryTableName c _) = c
tableNameCreator (EventTableName c _ _) = c
tableNameCreator (EventCollectionTableName c _ _ _) = c
tableNameCreator (AbstractTableName c _) = c

tableNameContractName :: TableName -> T.Text
tableNameContractName (IndexTableName _ n) = n
tableNameContractName (CollectionTableName _ n _) = n
tableNameContractName (HistoryTableName _ n) = n
tableNameContractName (EventTableName _ n _) = n
tableNameContractName (EventCollectionTableName _ n _ _) = n
tableNameContractName (AbstractTableName _ n) = n

tableNameCollectionName :: TableName -> T.Text
tableNameCollectionName (CollectionTableName _ _ c) = c
tableNameCollectionName (EventCollectionTableName _ _ _ c) = c
tableNameCollectionName _ = ""

tableNameEventName :: TableName -> T.Text
tableNameEventName (EventTableName _ _ e) = e
tableNameEventName (EventCollectionTableName _ _ e _) = e
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
