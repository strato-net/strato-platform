{-# LANGUAGE
  OverloadedStrings
  , TemplateHaskell
  , BangPatterns
  , FlexibleContexts
#-}

module Slipstream.OutputData where

import           BlockApps.Solidity.Value
import           Conduit
import           Control.Exception
import           Control.Monad
import           Data.Aeson                      (encode)
import qualified Data.ByteString.Char8           as BC
import qualified Data.ByteString                 as B
import qualified Data.ByteString.Lazy            as BL
import           Data.IORef.Lifted
import qualified Data.Map                        as Map
import           Data.Maybe                      (fromMaybe)
import qualified Data.Set                        as Set
import           Data.Text                       (Text)
import qualified Data.Text                       as T
import           Data.Text.Encoding              (decodeUtf8, encodeUtf8)
import           Database.PostgreSQL.Typed
import           Database.PostgreSQL.Typed.Query
import           Network
import           System.Log.Logger

import Slipstream.Events
import Slipstream.Globals
import Slipstream.Options
import Slipstream.SolidityValue

defaultMaxB :: Integer
defaultMaxB = 32 * 1024 * 1024

tshow :: Show a => a -> Text
tshow = T.pack . show

typeText :: SolidityValue -> Text
typeText (SolidityValueAsString _) = "text"
typeText (SolidityNum _) = "bigint"
typeText (SolidityBool _) = "bool"
typeText (_) = "json"

listToKeyStatement :: Text -> [(Text, b)] -> Text
listToKeyStatement _ [] = ""
listToKeyStatement _ [(x, _)] = T.concat ["\"", x, "\""]
listToKeyStatement s ((x,_):es) = T.concat ["\"", x, "\"", s, (listToKeyStatement s es)]

solidityValueToText :: Text -> SolidityValue -> Text
solidityValueToText s (SolidityValueAsString x) = T.concat [s, (escapeQuotes x), s]
solidityValueToText s (SolidityBool x) = T.concat [s, tshow x, s]
solidityValueToText s (SolidityNum x ) = T.concat [s, tshow x, s]
solidityValueToText s (SolidityBytes x) = T.concat [s, (escapeQuotes $ tshow x), s]
solidityValueToText s (SolidityArray x) = T.concat [s, (decodeUtf8 . BL.toStrict $ encode x), s]
solidityValueToText s (SolidityObject x) = T.concat [s, (decodeUtf8 . BL.toStrict $ encode x), s]

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
arrayToString (x:es) = T.concat [arrayContent x, ", ", arrayToString es]

listToValueStatement :: Text -> [(a, SolidityValue)] -> Text
listToValueStatement _ [] = ""
listToValueStatement _ [(_, y)] = solidityValueToText "\'" y
listToValueStatement s ((_, y):es) = T.concat [solidityValueToText "\'" y, s, (listToValueStatement s es)]

tableColumns :: [(Text, SolidityValue)] -> Text
tableColumns [] = ""
tableColumns [(x, y)] = T.concat ["\"", x, "\"", " ", typeText y]
tableColumns ((x, y):es) = T.concat ["\"", x, "\"", " ", typeText y, ", ", tableColumns es]

tableUpsert :: [(Text, SolidityValue)] -> Text
tableUpsert [] = ""
tableUpsert [(x, _)] = T.concat ["\"", x, "\"", " = excluded.", "\"", x, "\""]
tableUpsert ((x, _):es) = T.concat ["\"", x, "\"", " = excluded.", "\"", x, "\"",  ", ", tableUpsert es]


dbConnect :: PGDatabase
dbConnect =  PGDatabase
  { pgDBHost = flags_pghost :: HostName
  , pgDBPort = PortNumber $ read flags_pgport
  , pgDBUser = BC.pack flags_pguser :: B.ByteString
  , pgDBPass = BC.pack flags_password :: B.ByteString
  , pgDBName = BC.pack flags_database :: B.ByteString
  , pgDBDebug = False
  , pgDBLogMessage = infoM "pglog" . show . PGError
  , pgDBParams = [("Timezone", "UTC")]
  }

dbInsert :: PGConnection -> Text -> IO ()
dbInsert conn insrt = do
  let qry = rawPGSimpleQuery $! encodeUtf8 insrt
  _ <- pgQuery conn qry
  return ()

isFunction :: Value -> Bool
isFunction (ValueFunction _ _ _) = False
isFunction (_) = True

handlePostgresError :: (MonadIO m) => SomeException -> m ()
handlePostgresError = liftIO . putStrLn . ("postgres error: " ++) . show

convertRet :: [ProcessedContract] -> PGConnection -> IORef Globals -> IO()
convertRet metadata conn globalsIORef = runConduit $
     yield metadata
  .| createInserts globalsIORef
  .| catchC (mapM_C (dbInsert conn)) handlePostgresError

createInserts :: (MonadIO m, MonadBase IO m) => IORef Globals -> Conduit [ProcessedContract] m Text
createInserts globalsIORef = do
  metadata <- fromMaybe (error "createInserts called without contracts") <$> await
  let firstContract = head metadata
  let hashVal = codehash firstContract
  globals <- readIORef globalsIORef
  let contractAlreadyCreated = hashVal `Set.member` createdContracts globals

  liftIO . debugM "createInserts" . show $ T.concat ["In convertRet, ", tshow hashVal, " contractAlreadyCreated = ", tshow contractAlreadyCreated]

  if (length metadata > 1)
    then do
      when (not $ contractAlreadyCreated) $ do
          let conVals = T.concat ["('", (codehash $ head metadata), "', '", (contractName $ head metadata), "', '", (abi $ head metadata), "', '", (chain $ head metadata), "')"]
          let conIns = T.concat ["insert into contract (\"codeHash\", contract, abi, \"chainId\") values ", conVals, " ON CONFLICT DO NOTHING;"]
          _ <- writeIORef globalsIORef globals{createdContracts=Set.insert hashVal (createdContracts globals)}
          yield conIns

      let fstContract = contractData $ head metadata
      let list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ fstContract
      let comma = if (length list == 0)
          then ""
          else ", "
      let createSt = T.concat ["create table if not exists \"", (contractName $ head metadata), "\" (address text, \"chainId\" text", comma, tableColumns list, ", CONSTRAINT \"", (contractName $ head metadata), "_pkey\" PRIMARY KEY (address, \"chainId\") );"]
      yield createSt

      let keySt = T.concat ["(", "address, \"chainId\"", comma, listToKeyStatement ", " list, ")"]

      vals <- forM metadata $ \row -> do
            let rowList = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData row
            let rowSt = T.concat ["(", "'", address row, "', '", chain row, "'", comma, listToValueStatement ", " rowList, ")"]
            return rowSt

      let inserts = T.intercalate ", " vals
      let ins = T.concat ["insert into \"", (contractName $ head metadata), "\" ", keySt, " values ", inserts, " on conflict (address, \"chainId\") do update set address = excluded.address, \"chainId\" = excluded.\"chainId\"", comma, (tableUpsert list), ";"]

      yield ins
  else do
    let row = head metadata

    when(not contractAlreadyCreated) $ do
          let conVals = T.concat ["('", codehash row, "', '", contractName row, "', '", abi row, "', '", chain row, "')"]
          let conIns = T.concat ["insert into contract (\"codeHash\", contract, abi, \"chainId\") values ", conVals, " ON CONFLICT DO NOTHING;"]
          _ <- writeIORef globalsIORef globals{createdContracts=Set.insert hashVal (createdContracts globals)}
          yield conIns
    let list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData row
    let comma = if (length list == 0)
        then ""
        else ", "
    let createSt = T.concat ["create table if not exists \"", contractName row, "\" (address text, \"chainId\" text", comma, tableColumns list, ", CONSTRAINT \"", contractName row,"_pkey\" PRIMARY KEY (address, \"chainId\") );"]
    yield createSt

    let keySt = T.concat ["(", "address, \"chainId\"", comma, listToKeyStatement ", " list, ")"]
    let vals = T.concat ["(", "'", address row, "', '", chain row, "'", comma , listToValueStatement ", " list, ")"]
    let ins = T.concat ["insert into \"", contractName row, "\" ", keySt, " values ", vals, " on conflict (address, \"chainId\") do update set address = excluded.address, \"chainId\" = excluded.\"chainId\"", comma, (tableUpsert list), ";"]
    yield ins
