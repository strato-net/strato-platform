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
typeText (_) = "jsonb"

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

enableHistory :: Text -> Bool
enableHistory cName = elem cName ["Vehicle", "Hashmap"]

--Populate exclusion list
enableIndexing :: Text -> Bool
enableIndexing cName = notElem cName [""]

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
  let tableName = contractName firstContract

  let list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData firstContract
  let comma = if (length list == 0)
      then ""
      else ", "

  let keySt = T.concat ["(", "address, \"chainId\"", comma, listToKeyStatement ", " list, ")"]

  liftIO . debugM "createInserts" . show $ T.concat ["In convertRet, ", tshow hashVal, " contractAlreadyCreated = ", tshow contractAlreadyCreated]

  --When contract hasn't been written to "contract" table and indexing table doesn't exist
  when (not $ contractAlreadyCreated) $ do
      let conVals = T.concat ["('", tshow $ codehash firstContract, "', '", contractName firstContract, "', '", abi firstContract, "', '", chain firstContract, "')"]
      let conIns = T.concat ["insert into contract (\"codeHash\", contract, abi, \"chainId\") values ", conVals, " ON CONFLICT DO NOTHING;"]
      yield conIns
      let createSt = T.concat
              [ "create table if not exists \""
              , tableName
              , "\" (address text, \"chainId\" text, block_hash text, block_timestamp text, block_number text, transaction_hash text, transaction_sender text"
              , comma
              , tableColumns list
              , ", CONSTRAINT \""
              , tableName
              , "_pkey\" PRIMARY KEY (address, \"chainId\") );" ]
      yield createSt

      when (enableHistory tableName) $ do
        let histSt = T.concat
              [ "create table if not exists \""
              , tableName
              , "_history\" (address text, \"chainId\" text, block_hash text, block_timestamp text, block_number text, transaction_hash text, transaction_sender text"
              , comma
              , tableColumns list
              , ");" ]
        yield histSt
      _ <- writeIORef globalsIORef globals{createdContracts=Set.insert hashVal (createdContracts globals)}
      return ()
  vals <- forM metadata $ \row -> do
        let rowList = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData row
        let rowSt = T.concat
              [ "('"
              , tshow $ address row
              , "', '"
              , chain row
              , "', '"
              , tshow $ blockHash row
              , "', '"
              , tshow $ blockTimestamp row
              , "', '"
              , tshow $ blockNumber row
              , "', '"
              , tshow $ transactionHash row
              ,"', '"
              , tshow $ transactionSender row
              , "'"
              , comma
              , listToValueStatement ", " rowList
              , ")" ]
        return rowSt
  let inserts = T.intercalate ", " vals

  when (enableHistory tableName) $ do
    let hist = T.concat ["insert into \"", tableName, "_history\" ", keySt, " values ", inserts, ";"]
    yield hist

  when (enableIndexing tableName) $ do
    let ins = T.concat
          [ "insert into \""
          , tableName
          , "\" "
          , keySt
          , " values "
          , inserts
          , " on conflict (address, \"chainId\") do update set address = excluded.address, \"chainId\" = excluded.\"chainId\", "
          , "block_hash = excluded.block_hash, block_timestamp = excluded.block_timestamp, block_number = excluded.block_number, "
          , "transaction_hash = excluded.transaction_hash, transaction_sender = excluded.transaction_sender"
          , comma
          , (tableUpsert list)
          , ";" ]
    yield ins
