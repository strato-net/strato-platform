-- library for all sql query formatting functions
{-# LANGUAGE OverloadedStrings #-}
module Slipstream.QueryFormatHelper where

import qualified Data.Text as T
import           Slipstream.Data.Globals (TableName(..))

tshow :: Show a => a -> T.Text
tshow = T.pack . show

csv :: [T.Text] -> T.Text
csv = T.intercalate ",\n    "

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

tableSeparator :: T.Text
tableSeparator = "-"

tableNameToText :: TableName -> T.Text
tableNameToText (IndexTableName o a c) =
  let prefix
        | T.null o = ""
        | T.null a = o <> tableSeparator
        | otherwise = o <> tableSeparator <> a <> tableSeparator
  in prefix <> c
tableNameToText (MappingTableName o a c m ) =
  let prefix
        | T.null o = ""
        | T.null a = o <> tableSeparator
        | otherwise = o <> tableSeparator <> a <> tableSeparator
      contractAndMapping = c <> "." <> m
  in "mapping@" <> prefix <> contractAndMapping
tableNameToText (HistoryTableName o a c) =
  let prefix
        | T.null o = ""
        | T.null a = o <> tableSeparator
        | otherwise = o <> tableSeparator <> a <> tableSeparator
  in "history@" <> prefix <> c
tableNameToText (EventTableName o a c e) =
  let prefix
        | T.null o = ""
        | T.null a = o <> tableSeparator
        | otherwise = o <> tableSeparator <> a <> tableSeparator
      contractAndEvent = c <> "." <> e
  in prefix <> contractAndEvent

tableNameToTextPostgres :: TableName -> T.Text
tableNameToTextPostgres = T.take 63 . tableNameToText -- max table name len in psql is 63 char

tableNameToSingleQuoteText :: TableName -> T.Text
tableNameToSingleQuoteText = wrapSingleQuotes . escapeQuotes . tableNameToTextPostgres

tableNameToDoubleQuoteText :: TableName -> T.Text
tableNameToDoubleQuoteText = wrapDoubleQuotes . escapeQuotes . tableNameToText

