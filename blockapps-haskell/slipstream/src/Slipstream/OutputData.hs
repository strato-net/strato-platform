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
--import Control.Monad.IO.Class
import qualified Data.List as L
import Data.IORef
--import BlockApps.Bloc22.Monad

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

dbInsert :: String -> PGConnection -> IO()
dbInsert insrt conn = do
  let qry = rawPGSimpleQuery $! BC.pack insrt
  _ <- pgQuery conn qry
  return ()

isFunction :: Value -> Bool
isFunction (ValueFunction _ _ _) = False
isFunction (_) = True

--convertRet :: String -> String -> String -> String -> String -> PGConnection -> Map.Map T.Text Value -> IO()
convertRet :: [ProcessedContract] -> PGConnection -> IORef (Map.Map String ContractAndXabi) -> IO()
convertRet metadata conn cache = do
  let firstContract = head metadata
  let hashVal = codehash firstContract
  contractCache <- readIORef cache
  cachedContract <- case Map.lookup hashVal contractCache of
    Just x -> return x
    Nothing -> return ContractAndXabi{contract = Left "error", xabi = "error", name = "error", contractStored = False}
  --TODO: Re-enable Indexing flag
{-
  let indFlag = True
  ind <- if (indFlag)
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
                return $ createSt ++ delRow ++ ins
              else return $ ""
  -}
  --TODO: Re-enable History flag
  {-
    --History flag
    let histFlag = True
    let hist = if (histFlag)
                --TODO: Add history insert statement (transaction, state)
                then ""
                else ""
  -}

  if (length metadata > 1)
    then do
      when (not $ contractStored cachedContract) $ do
          --List of conVals
          let conVals = map (\row -> "('" ++ codehash row ++ "', '" ++ contractName row ++ "', '" ++ abi row ++ "', '" ++ chain row ++ "')") metadata
          --Split List with commas
          let conIns = "insert into contract (\"codeHash\", contract, abi, \"chainId\") values " ++ (L.intercalate ", " conVals) ++ " ON CONFLICT DO NOTHING;"
          let newState _ = ContractAndXabi{contract = contract cachedContract, xabi = xabi cachedContract, name = name cachedContract, contractStored = True}
          _ <- writeIORef cache (Map.adjust newState hashVal contractCache)
          dbInsert conIns conn

      --Keys list
      let fstContract = contractData $ head metadata
      let list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ fstContract
      let comma = if (length list == 0)
          then ""
          else ", "
      let createSt = "create table if not exists \"" ++ (contractName $ head metadata) ++ "\" (address text, \"chainId\" text" ++ comma ++ tableColumns list ++ ");"
      dbInsert createSt conn

      --List of delRow
      _ <- forM_ metadata $ \row -> do
            let delSt = "delete from \"" ++ contractName row ++ "\" where address='" ++ address row ++ "' and \"chainId\"='" ++ chain row ++ "';"
            dbInsert delSt conn

      let keySt = "(" ++ "address, \"chainId\"" ++ comma ++ listToKeyStatement ", " list ++ ")"

      --List of vals
      --let valList = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ metadata
      vals <- forM metadata $ \row -> do
            let rowList = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData row
            let rowSt = "(" ++ "'" ++ address row ++ "', '" ++ chain row ++ "'" ++ comma ++ listToValueStatement ", " rowList ++ ")"
            return rowSt
      --Split vals with commas
      putStrLn $ "Inserting " ++ show (length vals) ++ " new contracts"
      let inserts = L.intercalate ", " vals
      let ins = "insert into \"" ++ (contractName $ head metadata) ++ "\" " ++ keySt ++ " values " ++ inserts ++ ";"

      dbInsert ins conn
  else do
    let row = head metadata

    if(contractStored cachedContract)
      then return ()
    else do
          let conVals = "('" ++ codehash row ++ "', '" ++ contractName row ++ "', '" ++ abi row ++ "', '" ++ chain row ++ "')"
          let conIns = "insert into contract (\"codeHash\", contract, abi, \"chainId\") values " ++ conVals ++ " ON CONFLICT DO NOTHING;"
          let newState _ = ContractAndXabi{contract = contract cachedContract, xabi = xabi cachedContract, name = name cachedContract, contractStored = True}
          --_ <- liftIO $ putStrLn $ "newState: " ++ show (newState hashVal)
          _ <- writeIORef cache (Map.adjust newState hashVal contractCache)
          dbInsert conIns conn
    let list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData row
    let comma = if (length list == 0)
        then ""
        else ", "
    let createSt = "create table if not exists \"" ++ contractName row ++ "\" (address text, \"chainId\" text" ++ comma ++ tableColumns list ++ ");"

    dbInsert createSt conn

    let delRow = "delete from \"" ++ contractName row ++ "\" where address='" ++ address row ++ "' and \"chainId\"='" ++ chain row ++ "';"
    dbInsert delRow conn
    let keySt = "(" ++ "address, \"chainId\"" ++ comma ++ listToKeyStatement ", " list ++ ")"
    let vals = "(" ++ "'" ++ address row ++ "', '" ++ chain row ++ "'" ++ comma  ++ listToValueStatement ", " list ++ ")"
    let ins = "insert into \"" ++ contractName row ++ "\" " ++ keySt ++ " values " ++ vals ++ ";"
    dbInsert ins conn
  return ()
