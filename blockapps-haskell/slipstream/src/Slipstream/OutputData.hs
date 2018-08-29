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
import Data.List.Utils (replace)
import Slipstream.Events
import Control.Monad
import qualified Data.List as L
import Data.IORef
import Data.Maybe

defaultMaxB :: Integer
defaultMaxB = 32 * 1024 * 1024

valueToTxt :: SolidityValue -> String
valueToTxt (SolidityNum _) = "bigint"
valueToTxt (SolidityBool _) = "bool"
valueToTxt (SolidityArray _) = "text []"
valueToTxt (_) = "text"

listToKeyStatement :: String -> [(T.Text, b)] -> String
listToKeyStatement _ [] = []
listToKeyStatement _ [(x, _)] = "\"" ++ T.unpack x ++ "\""
listToKeyStatement s ((x,_):es) = "\"" ++ T.unpack x ++ "\"" ++ s ++ (listToKeyStatement s es)

valueToString :: String -> SolidityValue -> String
valueToString s (SolidityValueAsString x) = s ++ (escapeQuotes $ T.unpack x) ++ s
valueToString s (SolidityBool x) = s ++ show x ++ s
valueToString s (SolidityNum x ) = s ++ show x ++ s
valueToString s (SolidityBytes x) = s ++ (escapeQuotes $ show x) ++ s
valueToString s (SolidityArray x) = s ++ "{" ++ arrayToString x ++ "}" ++ s
valueToString s (SolidityObject x) = s ++ (escapeQuotes $ show x) ++ s

escapeQuotes :: String -> String
escapeQuotes x = replace "\'" "\'\'" $ replace "\"" "\\\"" x

arrayContent :: SolidityValue -> String
arrayContent (SolidityValueAsString x) = escapeQuotes $ T.unpack x
arrayContent (SolidityBool x) = show x
arrayContent (SolidityNum x ) = show x
arrayContent (SolidityBytes x) = escapeQuotes $ show x
arrayContent (SolidityArray x) = escapeQuotes $ show x
arrayContent (SolidityObject x) = escapeQuotes $ show x

arrayToString :: [SolidityValue] -> String
arrayToString [] = []
arrayToString [x] =  arrayContent x
arrayToString (x:es) = arrayContent x ++ ", " ++ arrayToString es

listToValueStatement :: String -> [(a, SolidityValue)] -> String
listToValueStatement _ [] = []
listToValueStatement _ [(_, y)] = valueToString "\'" y
listToValueStatement s ((_, y):es) = valueToString "\'" y ++ s ++ (listToValueStatement s es)

tableColumns :: [(T.Text, SolidityValue)] -> String
tableColumns [] = []
tableColumns [(x, y)] = "\"" ++ T.unpack x ++ "\"" ++ " " ++ valueToTxt y
tableColumns ((x, y):es) = "\"" ++ T.unpack x ++ "\"" ++ " " ++ valueToTxt y ++ ", " ++ tableColumns es

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

dbSelect :: String -> IO [String]
dbSelect statement = do
  conn <- pgConnect dbConnect
  let qry = rawPGSimpleQuery $ BC.pack statement
  ret <- pgQuery conn qry
  pgDisconnect conn
  return $ map show ret

compareSchema :: String -> String -> IO Bool
compareSchema query schema = do
  tOrF <- dbSelect query
  return (concat tOrF == schema)

isFunction :: Value -> Bool
isFunction (ValueFunction _ _ _) = False
isFunction (_) = True

convertRet :: [ProcessedContract] -> PGConnection -> IORef (Map.Map String ContractAndXabi) -> IO()
convertRet metadata conn cache = do
  let firstContract = head metadata
  let officialName = contractName firstContract
  putStrLn $ "firstContract name: " ++ show (contractName firstContract)
  let hashVal = codehash firstContract
  contractCache <- readIORef cache
  cachedContract <- case Map.lookup hashVal contractCache of
    Just x -> return x
    Nothing -> return ContractAndXabi{contract = Left "error", xabi = "error", name = "error", contractStored = False, resolvedName = Nothing, contractSchema = Nothing}
  let tableName = case resolvedName cachedContract of
        Just x -> x
        Nothing -> contractName firstContract

  let list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData firstContract
  let comma = if (length list == 0)
      then ""
      else ", "

  --TODO: Re-enable Indexing flag

  if (length metadata > 1)
    then do
      when (not $ contractStored cachedContract) $ do
          let conVals = "('" ++ (codehash firstContract) ++ "', '" ++ (contractName firstContract) ++ "', '" ++ (abi firstContract) ++ "', '" ++ (chain firstContract) ++ "')"
          let conIns = "insert into contract (\"codeHash\", contract, abi, \"chainId\") values " ++ conVals ++ " ON CONFLICT DO NOTHING;"
          let newState _ = ContractAndXabi{contract = contract cachedContract, xabi = xabi cachedContract, name = name cachedContract, contractStored = True, resolvedName = resolvedName cachedContract, contractSchema = Just (tableColumns list)}
          _ <- writeIORef cache (Map.adjust newState hashVal contractCache)
          dbInsert conIns conn

      let createSt = "create table if not exists \"" ++ tableName ++ "\" (address text, \"chainId\" text" ++ comma ++ tableColumns list ++ ", CONSTRAINT \"" ++ tableName ++ "_pkey\" PRIMARY KEY (address, \"chainId\") );"
      dbInsert createSt conn

      let keySt = "(" ++ "address, \"chainId\"" ++ comma ++ listToKeyStatement ", " list ++ ")"

      vals <- forM metadata $ \row -> do
            let rowList = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData row
            let rowSt = "(" ++ "'" ++ address row ++ "', '" ++ chain row ++ "'" ++ comma ++ listToValueStatement ", " rowList ++ ")"
            return rowSt

      putStrLn $ "Inserting " ++ show (length vals) ++ " new contracts"
      let inserts = L.intercalate ", " vals
      let ins = "insert into \"" ++ tableName ++ "\" " ++ keySt ++ " values " ++ inserts ++ " on conflict (address, \"chainId\") do update set address = excluded.address, \"chainId\" = excluded.\"chainId\"" ++ comma ++ (tableUpsert list) ++ ";"
      dbInsert ins conn

    else do
      when (not $ contractStored cachedContract) $ do
          let conVals = "('" ++ codehash firstContract ++ "', '" ++ contractName firstContract ++ "', '" ++ abi firstContract ++ "', '" ++ chain firstContract ++ "')"
          let conIns = "insert into contract (\"codeHash\", contract, abi, \"chainId\") values " ++ conVals ++ " ON CONFLICT DO NOTHING;"
          let newState _ = ContractAndXabi{contract = contract cachedContract, xabi = xabi cachedContract, name = name cachedContract, contractStored = True, resolvedName = resolvedName cachedContract, contractSchema = Just (tableColumns list)}
          _ <- writeIORef cache (Map.adjust newState hashVal contractCache)
          dbInsert conIns conn

      let createSt = "create table if not exists \"" ++ tableName ++ "\" (address text, \"chainId\" text" ++ comma ++ tableColumns list ++ ", CONSTRAINT \"" ++ tableName ++"_pkey\" PRIMARY KEY (address, \"chainId\") );"
      dbInsert createSt conn

      let keySt = "(" ++ "address, \"chainId\"" ++ comma ++ listToKeyStatement ", " list ++ ")"
      let vals = "(" ++ "'" ++ address firstContract ++ "', '" ++ chain firstContract ++ "'" ++ comma  ++ listToValueStatement ", " list ++ ")"
      let ins = "insert into \"" ++ tableName ++ "\" " ++ keySt ++ " values " ++ vals ++ " on conflict (address, \"chainId\") do update set address = excluded.address, \"chainId\" = excluded.\"chainId\"" ++ comma ++ (tableUpsert list) ++ ";"
      dbInsert ins conn

  newCache <- readIORef cache
  newCachedContract <-  case Map.lookup hashVal newCache of
        Just x -> return x
        Nothing -> return ContractAndXabi{contract = Left "error", xabi = "error", name = "error", contractStored = False, resolvedName = Nothing, contractSchema = Nothing}
  let newCacheList = Map.toList newCache

  --If ContractAndXabi resolvedName == name ++ "1" , then create view
  viewSt <- if(show (resolvedName newCachedContract) == name newCachedContract ++ "1")
    then do
      return $ "create view if not exists \"" ++ name newCachedContract ++ "\" as select * from \"" ++ name newCachedContract ++ "1\";"
    else do
      --Get the first contract that uses the name
      let originalSchemaContract = filter (\(_, y) -> resolvedName y == Just (officialName ++ "1")) newCacheList
      --Get the list of contracts that use the same name
      let sameNameList = filter (\(_, y) -> (name y) == (contractName firstContract)) newCacheList
      --Check how many have the same schema as the original contract
      let tableList = if (not $ null originalSchemaContract)
          then filter (\(_, y) -> (contractSchema y) == (contractSchema $ snd $ head originalSchemaContract)) sameNameList
          else []
      --Create a UNION statement for every table that matches the schema of the original contract
      let tableString = map (\table -> "UNION SELECT * FROM \"" ++ fromMaybe (name newCachedContract) (resolvedName $ snd table) ++ "\"") tableList

      return $ "create or replace view \"" ++ (name newCachedContract) ++ "\" as select * from \"" ++ (name newCachedContract) ++ "1\" " ++ (L.intercalate " " tableString) ++ ";"

  dbInsert viewSt conn

  return ()
