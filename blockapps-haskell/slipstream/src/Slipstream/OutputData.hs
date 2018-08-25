{-# LANGUAGE
  OverloadedStrings
  , TemplateHaskell
  , BangPatterns
#-}

module Slipstream.OutputData where

import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString as B
import qualified Data.Text as T
import Database.PostgreSQL.Typed
import Database.PostgreSQL.Typed.Query
import Network
import Slipstream.Options
import Slipstream.SolidityValue
import qualified Data.Map as Map
import BlockApps.Solidity.Value
import Data.List
import Data.List.Utils (replace)
import Slipstream.Events
import Control.Monad
import qualified Data.List as L
import Data.IORef

defaultMaxB :: Integer
defaultMaxB = 32 * 1024 * 1024

valueToTxt :: SolidityValue -> String
valueToTxt (SolidityNum _) = "bigint"
valueToTxt (SolidityBool _) = "bool"
valueToTxt (SolidityArray _) = "text []"
valueToTxt (_) = "text"

listToKeyStatement :: [(T.Text, b)] -> String
listToKeyStatement x = intercalate ", " $ map (quoteIt . T.unpack . fst) x

tableColumns :: [(T.Text, SolidityValue)] -> String
tableColumns = intercalate ", " . map tableColumn

tableColumn :: (T.Text, SolidityValue) -> String
tableColumn (x, y) = quoteIt (T.unpack x) ++ " " ++ valueToTxt y

listToValueStatement :: [(a, SolidityValue)] -> String
listToValueStatement x = intercalate ", " $ map (valueToString . snd) x

quoteIt :: String -> String
quoteIt x = "\"" ++ x ++ "\"" -- need some type of escaping here also

singleQuoteIt :: String -> String
singleQuoteIt x = "'" ++ escapeQuotes x ++ "'"

valueToString :: SolidityValue -> String
valueToString (SolidityValueAsString x) = singleQuoteIt $ T.unpack x
valueToString (SolidityBool x) = singleQuoteIt $ show x
valueToString (SolidityNum x ) = singleQuoteIt $ show x
valueToString (SolidityBytes x) = singleQuoteIt $ show x
valueToString (SolidityArray x) =
  singleQuoteIt $  "{" ++ intercalate ", " (map arrayContent x) ++ "}"
valueToString (SolidityObject x) = singleQuoteIt $ show x

escapeQuotes :: String -> String
escapeQuotes x = replace "\'" "\'\'" $ replace "\"" "\\\"" x

arrayContent :: SolidityValue -> String
arrayContent (SolidityValueAsString x) = escapeQuotes $ T.unpack x
arrayContent (SolidityBool x) = show x
arrayContent (SolidityNum x ) = show x
arrayContent (SolidityBytes x) = escapeQuotes $ show x
arrayContent (SolidityArray x) = escapeQuotes $ show x
arrayContent (SolidityObject x) = escapeQuotes $ show x



tableUpsert :: [(T.Text, SolidityValue)] -> String
tableUpsert [] = []
tableUpsert [(x, _)] = "\"" ++ T.unpack x ++ "\"" ++ " = excluded." ++ "\"" ++ T.unpack x ++ "\""
tableUpsert ((x, _):es) = "\"" ++ T.unpack x ++ "\"" ++ " = excluded." ++ "\"" ++ T.unpack x ++ "\"" ++  ", " ++ tableUpsert es


dbConnect :: PGDatabase
dbConnect =  PGDatabase
  { pgDBHost = flags_pghost :: HostName
  , pgDBPort = PortNumber $ read flags_pgport
  , pgDBUser = BC.pack flags_pguser :: B.ByteString
  , pgDBPass = BC.pack flags_password :: B.ByteString
  , pgDBName = BC.pack flags_database :: B.ByteString
  , pgDBDebug = False
  , pgDBLogMessage = print . PGError
  , pgDBParams = [("Timezone", "UTC")]
  }

dbInsert :: String -> PGConnection -> IO()
dbInsert insrt conn = do
  let qry = rawPGSimpleQuery $! BC.pack insrt
  _ <- pgQuery conn qry
  return ()

isFunction :: Value -> Bool
isFunction (ValueFunction _ _ _) = False
isFunction (_) = True

convertRet :: [ProcessedContract] -> PGConnection -> IORef (Map.Map String ContractAndXabi) -> IO()
convertRet metadata conn cache = do
  let firstContract = head metadata
  let hashVal = codehash firstContract
  contractCache <- readIORef cache
  cachedContract <- case Map.lookup hashVal contractCache of
    Just x -> return x
    Nothing -> return ContractAndXabi{contract = Left "error", xabi = "error", name = "error", contractStored = False}

  if (length metadata > 1)
    then do
      when (not $ contractStored cachedContract) $ do
          let conVals = "('" ++ (codehash $ head metadata) ++ "', '" ++ (contractName $ head metadata) ++ "', '" ++ (abi $ head metadata) ++ "', '" ++ (chain $ head metadata) ++ "')"
          let conIns = "insert into contract (\"codeHash\", contract, abi, \"chainId\") values " ++ conVals ++ " ON CONFLICT DO NOTHING;"
          let newState _ = ContractAndXabi{contract = contract cachedContract, xabi = xabi cachedContract, name = name cachedContract, contractStored = True}
          _ <- writeIORef cache (Map.adjust newState hashVal contractCache)
          dbInsert conIns conn

      let fstContract = contractData $ head metadata
      let list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ fstContract
      let comma = if (length list == 0)
          then ""
          else ", "
      let createSt = "create table if not exists \"" ++ (contractName $ head metadata) ++ "\" (address text, \"chainId\" text" ++ comma ++ tableColumns list ++ ", CONSTRAINT \"" ++ (contractName $ head metadata) ++ "_pkey\" PRIMARY KEY (address, \"chainId\") );"
      dbInsert createSt conn

      let keySt = "(" ++ "address, \"chainId\"" ++ comma ++ listToKeyStatement list ++ ")"

      vals <- forM metadata $ \row -> do
            let rowList = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData row
            let rowSt = "(" ++ "'" ++ address row ++ "', '" ++ chain row ++ "'" ++ comma ++ listToValueStatement rowList ++ ")"
            return rowSt

      let inserts = L.intercalate ", " vals
      let ins = "insert into \"" ++ (contractName $ head metadata) ++ "\" " ++ keySt ++ " values " ++ inserts ++ " on conflict (address, \"chainId\") do update set address = excluded.address, \"chainId\" = excluded.\"chainId\"" ++ comma ++ (tableUpsert list) ++ ";"

      dbInsert ins conn
  else do
    let row = head metadata

    if(contractStored cachedContract)
      then return ()
    else do
          let conVals = "('" ++ codehash row ++ "', '" ++ contractName row ++ "', '" ++ abi row ++ "', '" ++ chain row ++ "')"
          let conIns = "insert into contract (\"codeHash\", contract, abi, \"chainId\") values " ++ conVals ++ " ON CONFLICT DO NOTHING;"
          let newState _ = ContractAndXabi{contract = contract cachedContract, xabi = xabi cachedContract, name = name cachedContract, contractStored = True}
          _ <- writeIORef cache (Map.adjust newState hashVal contractCache)
          dbInsert conIns conn
    let list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData row
    let comma = if (length list == 0)
        then ""
        else ", "
    let createSt = "create table if not exists \"" ++ contractName row ++ "\" (address text, \"chainId\" text" ++ comma ++ tableColumns list ++ ", CONSTRAINT \"" ++ contractName row ++"_pkey\" PRIMARY KEY (address, \"chainId\") );"
    dbInsert createSt conn

    let keySt = "(" ++ "address, \"chainId\"" ++ comma ++ listToKeyStatement list ++ ")"
    let vals = "(" ++ "'" ++ address row ++ "', '" ++ chain row ++ "'" ++ comma  ++ listToValueStatement list ++ ")"
    let ins = "insert into \"" ++ contractName row ++ "\" " ++ keySt ++ " values " ++ vals ++ " on conflict (address, \"chainId\") do update set address = excluded.address, \"chainId\" = excluded.\"chainId\"" ++ comma ++ (tableUpsert list) ++ ";"
    dbInsert ins conn
  return ()
