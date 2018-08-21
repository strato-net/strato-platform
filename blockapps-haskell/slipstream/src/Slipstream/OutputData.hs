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
import Slipstream.SolidityValue
import qualified Data.Map as Map
import BlockApps.Solidity.Value
import Data.List.Utils (replace)

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
  _ <- pgRunQuery conn qry
  pgDisconnect conn

isFunction :: Value -> Bool
isFunction (ValueFunction _ _ _) = False
isFunction (_) = True

convertRet :: String -> String -> String -> String -> String -> Map.Map T.Text Value -> IO()
convertRet address codehash abi name chain x = do

  let conVals = "('" ++ codehash ++ "', '" ++ name ++ "', '" ++ abi ++ "', '" ++ chain ++ "')"
  let conIns = "insert into contract (\"codeHash\", contract, abi, \"chainId\") values " ++ conVals ++ " ON CONFLICT DO NOTHING;"

  --Indexing flag
  let indFlag = True
  let ind = if (indFlag)
              then do
                let list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction x
                let comma = if (length list == 0)
                    then ""
                    else ", "
                let createSt = "create table if not exists \"" ++ name ++ "\" (address text, \"chainId\" text" ++ comma ++ tableColumns list ++ ");"
                let delRow = "delete from \"" ++ name ++ "\" where address='" ++ address ++ "' and \"chainId\"='" ++ chain ++ "';"

                let keySt = "(" ++ "address, \"chainId\"" ++ comma ++ listToKeyStatement ", " list ++ ")"
                let vals = "(" ++ "'" ++ address ++ "', '" ++ chain ++ "'" ++ comma  ++ listToValueStatement ", " list ++ ")"
                let ins = "insert into \"" ++ name ++ "\" " ++ keySt ++ " values " ++ vals ++ ";"
                createSt ++ delRow ++ ins
              else ""

  --History flag
  let histFlag = True
  let hist = if (histFlag)
              --TODO: Add history insert statement (transaction, state)
              then ""
              else ""

  let oneIns = "BEGIN;" ++ conIns ++ ind ++ hist ++ "COMMIT;"

  dbInsert oneIns
