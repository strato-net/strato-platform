{-# LANGUAGE
  OverloadedStrings
  , TemplateHaskell
  , DeriveGeneric
  , QuasiQuotes
  , ScopedTypeVariables
  , DataKinds
  , TemplateHaskell
  , FlexibleContexts
  , GeneralizedNewtypeDeriving
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

--convertRet :: String -> String -> String -> String -> String -> Map.Map T.Text Value -> IO()
convertRet :: String -> String -> String -> ContractAndXabi -> String -> Map.Map T.Text Value -> IO()
convertRet address codehash abi cont chain x = do

  let contName = name cont
  let tableName = case (resolvedName cont) of
        Nothing -> contName
        Just otherName -> otherName

  let conVals = "('" ++ codehash ++ "', '" ++ tableName ++ "', '" ++ abi ++ "', '" ++ chain ++ "')"
  let conIns = "insert into contract (\"codeHash\", contract, abi, \"chainId\") values " ++ conVals ++ " ON CONFLICT DO NOTHING;"

  let list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction x
  let comma = if (length list == 0)
      then ""
      else ", "

  --Indexing flag
  let indFlag = True
  let ind = if (indFlag)
      then do
        let keySt = "(" ++ "address, \"chainId\"" ++ comma ++ listToKeyStatement ", " list ++ ")"
        let vals = "(" ++ "'" ++ address ++ "', '" ++ chain ++ "'" ++ comma  ++ listToValueStatement ", " list ++ ")"

        --History
        let histFlag = False
        let hist = if (histFlag)
            then do
              let createHist = "create table if not exists \"" ++ tableName ++ "_history\" (address text, \"chainId\" text" ++ comma ++ tableColumns list ++ ");"
              let copyHist = "insert into \"" ++ tableName ++ "_history" ++"\" select * from \"" ++ tableName ++ "\" where address='" ++ address ++ "' and \"chainId\"='" ++ chain ++ "';"
              createHist ++ copyHist
            else ""


        let createSt = "create table if not exists \"" ++ tableName ++ "\" (address text, \"chainId\" text" ++ comma ++ tableColumns list ++ ");"

        let delRow = "delete from \"" ++ tableName ++ "\" where address='" ++ address ++ "' and \"chainId\"='" ++ chain ++ "';"
        let ins = "insert into \"" ++ tableName ++ "\" " ++ keySt ++ " values " ++ vals ++ ";"
        createSt ++ hist ++ delRow ++ ins
      else ""

  viewSt <- if(indFlag)
      then do
        if(tableName == contName ++ "1")
        then
          return $ "create view \"" ++ contName ++ "\" as select * from \"" ++ tableName ++ "\";"
        else do
          let query = "\\d " ++ contName :: String
          let currentSchema = "(address text, \"chainId\" text" ++ comma ++ tableColumns list ++ ")"
          sameSchema <- compareSchema query currentSchema
          if (sameSchema)
            then return $ "create or replace view \"" ++ contName ++ "\" as select * from \"" ++ tableName ++ "\" union * from \"" ++ contName ++ "\"1;"
            else return ""
      else return ""
  let oneIns = "BEGIN;" ++ conIns ++ ind ++ viewSt ++ "COMMIT;"

  dbInsert oneIns

  --if index flag -> view
