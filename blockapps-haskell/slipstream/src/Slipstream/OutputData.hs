{-# LANGUAGE
  OverloadedStrings
  , TemplateHaskell
  , BangPatterns
  , FlexibleContexts
#-}

module Slipstream.OutputData where

import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString as B
import Data.Maybe (fromMaybe)
import qualified Data.Text as T
import Database.PostgreSQL.Typed
import Database.PostgreSQL.Typed.Query
import Network
import qualified Data.Map as Map
import qualified Data.Set as Set
import BlockApps.Solidity.Value
import Data.List.Utils (replace)
import Control.Monad
import Control.Monad.Base
import Control.Monad.IO.Class
import qualified Data.List as L
import Data.IORef.Lifted

import Conduit

import Slipstream.Events
import Slipstream.Globals
import Slipstream.Options
import Slipstream.SolidityValue

defaultMaxB :: Integer
defaultMaxB = 32 * 1024 * 1024

valueToTxt :: SolidityValue -> String
valueToTxt (SolidityNum _) = "bigint"
valueToTxt (SolidityBool _) = "bool"
valueToTxt (SolidityArray _) = "json"
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

dbInsert :: PGConnection -> String -> IO()
dbInsert conn insrt = do
  let qry = rawPGSimpleQuery $! BC.pack insrt
  _ <- pgQuery conn qry
  return ()

isFunction :: Value -> Bool
isFunction (ValueFunction _ _ _) = False
isFunction (_) = True

convertRet :: [ProcessedContract] -> PGConnection -> IORef Globals -> IO()
convertRet metadata conn globalsIORef = runConduit $
     yield metadata
  .| createInserts globalsIORef
  .| mapM_C (dbInsert conn)

createInserts :: (MonadIO m, MonadBase IO m) => IORef Globals -> Conduit [ProcessedContract] m String
createInserts globalsIORef = do
  metadata <- fromMaybe (error "createInserts called without contracts") <$> await
  let firstContract = head metadata
  let hashVal = codehash firstContract
  globals <- readIORef globalsIORef
  let contractAlreadyCreated = hashVal `Set.member` createdContracts globals

  liftIO $ putStrLn $ "In convertRet, " ++ show hashVal ++ " contractAlreadyCreated = " ++ show contractAlreadyCreated

  if (length metadata > 1)
    then do
      when (not $ contractAlreadyCreated) $ do
          let conVals = "('" ++ (codehash $ head metadata) ++ "', '" ++ (contractName $ head metadata) ++ "', '" ++ (abi $ head metadata) ++ "', '" ++ (chain $ head metadata) ++ "')"
          let conIns = "insert into contract (\"codeHash\", contract, abi, \"chainId\") values " ++ conVals ++ " ON CONFLICT DO NOTHING;"
          _ <- writeIORef globalsIORef globals{createdContracts=Set.insert hashVal (createdContracts globals)}
          yield conIns

      let fstContract = contractData $ head metadata
      let list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ fstContract
      let comma = if (length list == 0)
          then ""
          else ", "
      let createSt = "create table if not exists \"" ++ (contractName $ head metadata) ++ "\" (address text, \"chainId\" text" ++ comma ++ tableColumns list ++ ", CONSTRAINT \"" ++ (contractName $ head metadata) ++ "_pkey\" PRIMARY KEY (address, \"chainId\") );"
      yield createSt

      let keySt = "(" ++ "address, \"chainId\"" ++ comma ++ listToKeyStatement ", " list ++ ")"

      vals <- forM metadata $ \row -> do
            let rowList = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData row
            let rowSt = "(" ++ "'" ++ address row ++ "', '" ++ chain row ++ "'" ++ comma ++ listToValueStatement ", " rowList ++ ")"
            return rowSt

      let inserts = L.intercalate ", " vals
      let ins = "insert into \"" ++ (contractName $ head metadata) ++ "\" " ++ keySt ++ " values " ++ inserts ++ " on conflict (address, \"chainId\") do update set address = excluded.address, \"chainId\" = excluded.\"chainId\"" ++ comma ++ (tableUpsert list) ++ ";"

      yield ins
  else do
    let row = head metadata

    when(not contractAlreadyCreated) $ do
          let conVals = "('" ++ codehash row ++ "', '" ++ contractName row ++ "', '" ++ abi row ++ "', '" ++ chain row ++ "')"
          let conIns = "insert into contract (\"codeHash\", contract, abi, \"chainId\") values " ++ conVals ++ " ON CONFLICT DO NOTHING;"
          _ <- writeIORef globalsIORef globals{createdContracts=Set.insert hashVal (createdContracts globals)}
          yield conIns
    let list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData row
    let comma = if (length list == 0)
        then ""
        else ", "
    let createSt = "create table if not exists \"" ++ contractName row ++ "\" (address text, \"chainId\" text" ++ comma ++ tableColumns list ++ ", CONSTRAINT \"" ++ contractName row ++"_pkey\" PRIMARY KEY (address, \"chainId\") );"
    yield createSt

    let keySt = "(" ++ "address, \"chainId\"" ++ comma ++ listToKeyStatement ", " list ++ ")"
    let vals = "(" ++ "'" ++ address row ++ "', '" ++ chain row ++ "'" ++ comma  ++ listToValueStatement ", " list ++ ")"
    let ins = "insert into \"" ++ contractName row ++ "\" " ++ keySt ++ " values " ++ vals ++ " on conflict (address, \"chainId\") do update set address = excluded.address, \"chainId\" = excluded.\"chainId\"" ++ comma ++ (tableUpsert list) ++ ";"
    yield ins
