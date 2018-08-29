{-# LANGUAGE
  OverloadedStrings
  , TemplateHaskell
  , BangPatterns
#-}

module Slipstream.OutputData where

import           BlockApps.Solidity.Value
import           Control.Monad
import qualified Data.ByteString.Char8           as BC
import qualified Data.ByteString                 as B
import           Data.IORef
import qualified Data.Map                        as Map
import           Data.Monoid                     ((<>))
import qualified Data.Set                        as Set
import           Data.Text                       (Text)
import qualified Data.Text                       as T
import           Data.Text.Encoding              (encodeUtf8)
import           Database.PostgreSQL.Typed
import           Database.PostgreSQL.Typed.Query
import           Network

import Slipstream.Events
import Slipstream.Globals
import Slipstream.Options
import Slipstream.SolidityValue

defaultMaxB :: Integer
defaultMaxB = 32 * 1024 * 1024

tshow :: Show a => a -> Text
tshow = T.pack . show

typeText :: SolidityValue -> Text
typeText (SolidityNum _) = "bigint"
typeText (SolidityBool _) = "bool"
typeText (SolidityArray _) = "text []"
typeText (_) = "text"

listToKeyStatement :: Text -> [(Text, b)] -> Text
listToKeyStatement _ [] = ""
listToKeyStatement _ [(x, _)] = "\"" <> x <> "\""
listToKeyStatement s ((x,_):es) = "\"" <> x <> "\"" <> s <> (listToKeyStatement s es)

solidityValueToText :: Text -> SolidityValue -> Text
solidityValueToText s (SolidityValueAsString x) = s <> (escapeQuotes x) <> s
solidityValueToText s (SolidityBool x) = s <> tshow x <> s
solidityValueToText s (SolidityNum x ) = s <> tshow x <> s
solidityValueToText s (SolidityBytes x) = s <> (escapeQuotes $ tshow x) <> s
solidityValueToText s (SolidityArray x) = s <> "{" <> arrayToString x <> "}" <> s
solidityValueToText s (SolidityObject x) = s <> (escapeQuotes $ tshow x) <> s

escapeQuotes :: Text -> Text
escapeQuotes = T.replace "\'" "\'\'" . T.replace "\"" "\\\""

arrayContent :: SolidityValue -> Text
arrayContent (SolidityValueAsString x) = escapeQuotes x
arrayContent (SolidityBool x) = tshow x
arrayContent (SolidityNum x ) = tshow x
arrayContent (SolidityBytes x) = escapeQuotes $ tshow x
arrayContent (SolidityArray x) = escapeQuotes $ tshow x
arrayContent (SolidityObject x) = escapeQuotes $ tshow x

arrayToString :: [SolidityValue] -> Text
arrayToString [] = ""
arrayToString [x] =  arrayContent x
arrayToString (x:es) = arrayContent x <> ", " <> arrayToString es

listToValueStatement :: Text -> [(a, SolidityValue)] -> Text
listToValueStatement _ [] = ""
listToValueStatement _ [(_, y)] = solidityValueToText "\'" y
listToValueStatement s ((_, y):es) = solidityValueToText "\'" y <> s <> (listToValueStatement s es)

tableColumns :: [(Text, SolidityValue)] -> Text
tableColumns [] = ""
tableColumns [(x, y)] = "\"" <> x <> "\"" <> " " <> typeText y
tableColumns ((x, y):es) = "\"" <> x <> "\"" <> " " <> typeText y <> ", " <> tableColumns es

tableUpsert :: [(Text, SolidityValue)] -> Text
tableUpsert [] = ""
tableUpsert [(x, _)] = "\"" <> x <> "\"" <> " = excluded." <> "\"" <> x <> "\""
tableUpsert ((x, _):es) = "\"" <> x <> "\"" <> " = excluded." <> "\"" <> x <> "\"" <>  ", " <> tableUpsert es


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

dbInsert :: Text -> PGConnection -> IO()
dbInsert insrt conn = do
  let qry = rawPGSimpleQuery $! encodeUtf8 insrt
  _ <- pgQuery conn qry
  return ()

isFunction :: Value -> Bool
isFunction (ValueFunction _ _ _) = False
isFunction (_) = True

convertRet :: [ProcessedContract] -> PGConnection -> IORef Globals -> IO()
convertRet metadata conn globalsIORef = do
  let firstContract = head metadata
  let hashVal = codehash firstContract
  globals <- readIORef globalsIORef
  let contractAlreadyCreated = hashVal `Set.member` createdContracts globals

  print $ "In convertRet, " <> tshow hashVal <> " contractAlreadyCreated = " <> tshow contractAlreadyCreated

  if (length metadata > 1)
    then do
      when (not $ contractAlreadyCreated) $ do
          let conVals = "('" <> (codehash $ head metadata) <> "', '" <> (contractName $ head metadata) <> "', '" <> (abi $ head metadata) <> "', '" <> (chain $ head metadata) <> "')"
          let conIns = "insert into contract (\"codeHash\", contract, abi, \"chainId\") values " <> conVals <> " ON CONFLICT DO NOTHING;"
          _ <- writeIORef globalsIORef globals{createdContracts=Set.insert hashVal (createdContracts globals)}
          dbInsert conIns conn

      let fstContract = contractData $ head metadata
      let list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ fstContract
      let comma = if (length list == 0)
          then ""
          else ", "
      let createSt = "create table if not exists \"" <> (contractName $ head metadata) <> "\" (address text, \"chainId\" text" <> comma <> tableColumns list <> ", CONSTRAINT \"" <> (contractName $ head metadata) <> "_pkey\" PRIMARY KEY (address, \"chainId\") );"
      dbInsert createSt conn

      let keySt = "(" <> "address, \"chainId\"" <> comma <> listToKeyStatement ", " list <> ")"

      vals <- forM metadata $ \row -> do
            let rowList = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData row
            let rowSt = "(" <> "'" <> address row <> "', '" <> chain row <> "'" <> comma <> listToValueStatement ", " rowList <> ")"
            return rowSt

      let inserts = T.intercalate ", " vals
      let ins = "insert into \"" <> (contractName $ head metadata) <> "\" " <> keySt <> " values " <> inserts <> " on conflict (address, \"chainId\") do update set address = excluded.address, \"chainId\" = excluded.\"chainId\"" <> comma <> (tableUpsert list) <> ";"

      dbInsert ins conn
  else do
    let row = head metadata

    when(not contractAlreadyCreated) $ do
          let conVals = "('" <> codehash row <> "', '" <> contractName row <> "', '" <> abi row <> "', '" <> chain row <> "')"
          let conIns = "insert into contract (\"codeHash\", contract, abi, \"chainId\") values " <> conVals <> " ON CONFLICT DO NOTHING;"
          _ <- writeIORef globalsIORef globals{createdContracts=Set.insert hashVal (createdContracts globals)}
          dbInsert conIns conn
    let list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData row
    let comma = if (length list == 0)
        then ""
        else ", "
    let createSt = "create table if not exists \"" <> contractName row <> "\" (address text, \"chainId\" text" <> comma <> tableColumns list <> ", CONSTRAINT \"" <> contractName row <>"_pkey\" PRIMARY KEY (address, \"chainId\") );"
    dbInsert createSt conn

    let keySt = "(" <> "address, \"chainId\"" <> comma <> listToKeyStatement ", " list <> ")"
    let vals = "(" <> "'" <> address row <> "', '" <> chain row <> "'" <> comma  <> listToValueStatement ", " list <> ")"
    let ins = "insert into \"" <> contractName row <> "\" " <> keySt <> " values " <> vals <> " on conflict (address, \"chainId\") do update set address = excluded.address, \"chainId\" = excluded.\"chainId\"" <> comma <> (tableUpsert list) <> ";"
    dbInsert ins conn
  return ()
