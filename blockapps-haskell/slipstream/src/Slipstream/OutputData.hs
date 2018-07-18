{-# LANGUAGE
      OverloadedStrings
      , TemplateHaskell
#-}

module Slipstream.OutputData where

import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString as B
import qualified Data.Text as T
import Database.PostgreSQL.Typed
import Database.PostgreSQL.Typed.Query
import Network
import Slipstream.Options
import Slipstream.SolidityValue2
import qualified Data.Map as Map
import BlockApps.Solidity.Value

defaultMaxB :: Integer
defaultMaxB = 32 * 1024 * 1024

valueToTxt :: SolidityValue2 -> String
valueToTxt (SolidityNum _) = "bigint"
valueToTxt (SolidityBool2 _) = "bool"
valueToTxt (_) = "text"

listToKeyStatement :: String -> [(T.Text, b)] -> String
listToKeyStatement _ [] = []
listToKeyStatement _ [(x, _)] = "\"" ++ T.unpack x ++ "\""
listToKeyStatement s ((x,_):es) = "\"" ++ T.unpack x ++ "\"" ++ s ++ (listToKeyStatement s es)

valueToString :: String -> SolidityValue2 -> String
valueToString s (SolidityValueAsString2 x) = s ++ T.unpack x ++ s
valueToString s (SolidityBool2 x) = s ++ show x ++ s
valueToString s (SolidityNum x ) = s ++ show x ++ s
valueToString s (SolidityArray2 x) = s ++ show x ++ s
valueToString s (SolidityBytes2 x) = s ++ show x ++ s
valueToString s (SolidityObject2 x) = s ++ show x ++ s

listToValueStatement :: String -> [(a, SolidityValue2)] -> String
listToValueStatement _ [] = []
listToValueStatement _ [(_, y)] = valueToString "\'" y
listToValueStatement s ((_, y):es) = valueToString "\'" y ++ s ++ (listToValueStatement s es)

tableColumns :: [(T.Text, SolidityValue2)] -> String
tableColumns [] = []
tableColumns [(x, y)] = "\"" ++ T.unpack x ++ "\"" ++ " " ++ valueToTxt y
tableColumns ((x, y):es) = "\"" ++ T.unpack x ++ "\"" ++ " " ++ valueToTxt y ++ ", " ++ tableColumns es

conflictList :: [(T.Text, SolidityValue2)] -> String
conflictList [] = []
conflictList [(x, _)] = "\"" ++ T.unpack x ++ "\"=excluded.\"" ++ T.unpack x ++ "\""
conflictList ((x, _):es) = "\"" ++ T.unpack x ++ "\"=excluded.\"" ++ T.unpack x ++ "\", " ++ conflictList es

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

dbInsert :: String -> IO()
dbInsert insrt = do
  conn <- pgConnect dbConnect
  let qry = rawPGSimpleQuery $ BC.pack insrt
  let ins = pgRunQuery conn qry
  p <- ins
  print p
  --case p of
    --Too many logs? Create table statement every time
    --(-1, _) -> putStrLn $ "Error writing to the database"
    --(x, _) -> putStrLn "Successfully wrote to the database"
  pgDisconnect conn

isFunction :: Value -> Bool
isFunction (ValueFunction _ _ _) = False
isFunction (_) = True

convertRet :: String -> String -> String -> String -> Map.Map T.Text Value -> IO()
convertRet address codehash abi name x = do
      --Revisit to fix table name duplicates
      --let contractName = take 63 codehash

  --Indexing flag
  let indFlag = False
  let ind = if (indFlag)
              --then "create index if not exists idx ON \"" ++ contractName ++ "\" (address);"
              then "create index if not exists idx ON \"" ++ name ++ "\" (address);"
              else ""

  --History flag
  let histFlag = True
  let hist = if (histFlag)
              --TODO: Add history insert statement (block ID, state)
              then
                ""
                --let histCreate = "create table if not exists \"History\" (\"codeHash\" text, contract text, block_id text, state text)"
              else ""

  --let conVals = "('" ++ codehash ++ "', '" ++ contractName ++ "', '" ++ abi ++ "')"
  let conVals = "('" ++ codehash ++ "', '" ++ name ++ "', '" ++ abi ++ "')"
  let conIns = "insert into contract (\"codeHash\", contract, abi) values " ++ conVals ++ " ON CONFLICT DO NOTHING;"

  --let list = Map.toList $ Map.filter isString x
  let list = Map.toList $ Map.map valueToSolidityValue2 $ Map.filter isFunction x
  --putStrLn $ "{}{}{}list{}{}{}: " ++ show list

  let beg = "BEGIN;"
  let comm = "COMMIT;"
  let createSt = "create table if not exists \"" ++ name ++ "\" (address text primary key, " ++ tableColumns list ++ ");"
  let delRow = "delete from \"" ++ name ++ "\" where address='" ++ address ++ "';"

  let keySt = "(" ++ "address, " ++ listToKeyStatement ", " list ++ ")"
  let vals = "(" ++ "'" ++ address ++ "', "  ++ listToValueStatement ", " list ++ ")"
  --let conflict = conflictList list
  let ins = "insert into \"" ++ name ++ "\" " ++ keySt ++ " values " ++ vals ++ ";"
  --let ins = "insert into \"" ++ name ++ "\" " ++ keySt ++ " values " ++ vals ++ "  on conflict(address) do update set" ++ conflict ++ ";"
  let oneIns = beg ++ conIns ++ createSt ++ delRow ++ ind ++ hist ++ ins ++ comm
  --putStrLn $ "^^^STATEMENT^^^: " ++ ins
  p <- dbInsert oneIns
  print p
