{-# LANGUAGE
      OverloadedStrings
      , TemplateHaskell
#-}

module Slipstream.OutputData where

import Data.Aeson hiding (Error)
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy.Char8 as BLC
import qualified Data.HashMap.Strict as H
import qualified Data.ByteString as B
import qualified Data.Text as T
import Database.PostgreSQL.Typed
import Database.PostgreSQL.Typed.Query
import Network
import Slipstream.Options
import qualified Data.Vector as V
import Data.List

defaultMaxB :: Integer
defaultMaxB = 32 * 1024 * 1024

valueToText :: Value -> String
valueToText (Number _) = "bigint"
valueToText (_) = "text"

listToKeyStatement :: String -> [(T.Text, b)] -> String
listToKeyStatement _ [] = []
listToKeyStatement _ [(x, _)] = "\"" ++ T.unpack x ++ "\""
listToKeyStatement s ((x,_):es) = "\"" ++ T.unpack x ++ "\"" ++ s ++ (listToKeyStatement s es)

valueToString :: String -> Value -> String
valueToString s (String x) = s ++ T.unpack x ++ s
valueToString s (Number x) = s ++ show x ++ s
valueToString s (Array x) = s ++ (show $ V.toList x) ++ s
--TODO: add correct response
valueToString s (Object _) = s ++ "" ++ s
valueToString s (Bool x) = s ++ show x ++ s
valueToString s (Null) = s ++ "" ++ s

listToValueStatement :: String -> [(a, Value)] -> String
listToValueStatement _ [] = []
listToValueStatement _ [(_, y)] = valueToString "\'" y
listToValueStatement s ((_, y):es) = valueToString "\'" y ++ s ++ (listToValueStatement s es)

tableColumns :: [(T.Text, Value)] -> String
tableColumns [] = []
tableColumns [(x, y)] = "\"" ++ T.unpack x ++ "\"" ++ " " ++ valueToText y
tableColumns ((x, y):es) = "\"" ++ T.unpack x ++ "\"" ++ " " ++ valueToText y ++ ", " ++ tableColumns es

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

isString :: Value -> Bool
isString (String x) = not (isPrefixOf "function" (T.unpack x))
isString _ = True

convertRet :: String -> String -> String -> String -> BLC.ByteString -> IO()
convertRet address codehash abi name x = do
  case decode x of
    Nothing -> putStrLn $ "Error"
    Just (Object y) -> do
      --Revisit to fix table name duplicates
      --let contractName = take 63 codehash

      --Indexing flag
      let indFlag = True
      let ind = if (indFlag)
                  --then "create index if not exists idx ON \"" ++ contractName ++ "\" (address);"
                  then "create index if not exists idx ON \"" ++ name ++ "\" (address);"
                  else ""

      --History flag
      let histFlag = True
      let hist = if (histFlag)
                  --TODO: Add history insert statement (block ID, state, ???)
                  then ""
                  else ""

      --let conVals = "('" ++ codehash ++ "', '" ++ contractName ++ "', '" ++ abi ++ "')"
      let conVals = "('" ++ codehash ++ "', '" ++ name ++ "', '" ++ abi ++ "')"
      let conIns = "insert into contract (\"codeHash\", contract, abi) values " ++ conVals ++ ";"

      let list = H.toList $ H.filter isString y
      putStrLn $ "{}{}{}list{}{}{}: " ++ show list

      let beg = "BEGIN;"
      let comm = "COMMIT;"
      --let createSt = "create table if not exists \"" ++ contractName ++ "\" (address text, " ++ tableColumns list ++ ");"
      let createSt = "create table if not exists \"" ++ name ++ "\" (address text, " ++ tableColumns list ++ ");"

      let keys = "(" ++ "address, " ++ listToKeyStatement ", " list ++ ")"
      let vals = "(" ++ "'" ++ address ++ "', "  ++ listToValueStatement ", " list ++ ")"
      --let ins = "insert into \"" ++ contractName ++ "\" " ++ keys ++ " values " ++ vals ++ ";"
      let ins = "insert into \"" ++ name ++ "\" " ++ keys ++ " values " ++ vals ++ ";"
      let oneIns = beg ++ conIns ++ createSt ++ ind ++ hist ++ ins ++ comm
      putStrLn $ "^^^STATEMENT^^^: " ++ createSt
      p <- dbInsert oneIns
      print p
    Just(_) -> putStrLn $ "Received Non-Object"
