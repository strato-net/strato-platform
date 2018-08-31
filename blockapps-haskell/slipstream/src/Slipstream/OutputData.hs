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
import           Data.Monoid                     ((<>))
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
listToKeyStatement _ [(x, _)] = "\"" <> x <> "\""
listToKeyStatement s ((x,_):es) = "\"" <> x <> "\"" <> s <> (listToKeyStatement s es)

solidityValueToText :: Text -> SolidityValue -> Text
solidityValueToText s (SolidityValueAsString x) = s <> (escapeQuotes x) <> s
solidityValueToText s (SolidityBool x) = s <> tshow x <> s
solidityValueToText s (SolidityNum x ) = s <> tshow x <> s
solidityValueToText s (SolidityBytes x) = s <> (escapeQuotes $ tshow x) <> s
solidityValueToText s (SolidityArray x) = s <> (decodeUtf8 . BL.toStrict $ encode x) <> s
solidityValueToText s (SolidityObject x) = s <> (decodeUtf8 . BL.toStrict $ encode x) <> s

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
  let officialName = contractName firstContract
  let hashVal = codehash firstContract
  globals <- readIORef globalsIORef
  let contractAlreadyCreated = hashVal `Set.member` createdContracts globals
  cachedContract <- getCachedContract globalsIORef hashVal

  let tableName = case cachedContract of
        Just c -> fromMaybe (contractName firstContract)(resolvedName c)
        Nothing -> contractName firstContract

  let list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData firstContract
  let comma = if (length list == 0)
      then ""
      else ", "

  liftIO . debugM "createInserts" . show $ "In convertRet, " <> tshow hashVal <> " contractAlreadyCreated = " <> tshow contractAlreadyCreated

  if (length metadata > 1)
    then do
      when (not $ contractAlreadyCreated) $ do
          let conVals = "('" <> (codehash firstContract) <> "', '" <> (contractName firstContract) <> "', '" <> (abi firstContract) <> "', '" <> (chain firstContract) <> "')"
          let conIns = "insert into contract (\"codeHash\", contract, abi, \"chainId\") values " <> conVals <> " ON CONFLICT DO NOTHING;"
          _ <- writeIORef globalsIORef globals{createdContracts=Set.insert hashVal (createdContracts globals)}
          yield conIns

      let createSt = "create table if not exists \"" <> tableName <> "\" (address text, \"chainId\" text" <> comma <> tableColumns list <> ", CONSTRAINT \"" <> tableName <> "_pkey\" PRIMARY KEY (address, \"chainId\") );"
      yield createSt

      let keySt = "(" <> "address, \"chainId\"" <> comma <> listToKeyStatement ", " list <> ")"

      vals <- forM metadata $ \row -> do
            let rowList = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData row
            let rowSt = "(" <> "'" <> address row <> "', '" <> chain row <> "'" <> comma <> listToValueStatement ", " rowList <> ")"
            return rowSt

      let inserts = T.intercalate ", " vals
      let ins = "insert into \"" <> tableName <> "\" " <> keySt <> " values " <> inserts <> " on conflict (address, \"chainId\") do update set address = excluded.address, \"chainId\" = excluded.\"chainId\"" <> comma <> (tableUpsert list) <> ";"

      yield ins
  else do
    when(not contractAlreadyCreated) $ do
          let conVals = "('" <> codehash firstContract <> "', '" <> contractName firstContract <> "', '" <> abi firstContract <> "', '" <> chain firstContract <> "')"
          let conIns = "insert into contract (\"codeHash\", contract, abi, \"chainId\") values " <> conVals <> " ON CONFLICT DO NOTHING;"
          _ <- writeIORef globalsIORef globals{createdContracts=Set.insert hashVal (createdContracts globals)}
          yield conIns

    let createSt = "create table if not exists \"" <> tableName <> "\" (address text, \"chainId\" text" <> comma <> tableColumns list <> ", CONSTRAINT \"" <> tableName <>"_pkey\" PRIMARY KEY (address, \"chainId\") );"
    yield createSt

    let keySt = "(" <> "address, \"chainId\"" <> comma <> listToKeyStatement ", " list <> ")"
    let vals = "(" <> "'" <> address firstContract <> "', '" <> chain firstContract <> "'" <> comma  <> listToValueStatement ", " list <> ")"
    let ins = "insert into \"" <> tableName <> "\" " <> keySt <> " values " <> vals <> " on conflict (address, \"chainId\") do update set address = excluded.address, \"chainId\" = excluded.\"chainId\"" <> comma <> (tableUpsert list) <> ";"
    yield ins

  newCache <- readIORef globalsIORef
  newCachedContract <-  case Map.lookup hashVal $ contractCache newCache of
        Just x -> return x
        Nothing -> return ContractAndXabi{contract = Left "error", xabi = "error", name = "error", contractStored = False, resolvedName = Nothing, contractSchema = Nothing}
  let newCacheList = Map.toList $ contractCache newCache

  --If ContractAndXabi resolvedName == name ++ "1" , then create view
  viewSt <- if(resolvedName newCachedContract == Just (name newCachedContract <> "1"))
      then do
        return $ "create or replace view \"" <> name newCachedContract <> "\" as select * from \"" <> name newCachedContract <> "1\";"
      else do
        --Get the first contract that uses the name
        let originalSchemaContract = filter (\(_, y) -> resolvedName y == Just (officialName <> "1")) newCacheList
        --Get the list of contracts that use the same name
        let sameNameList = filter (\(_, y) -> (name y) == (contractName firstContract)) newCacheList
        --Check how many have the same schema as the original contract
        let tableList = if (not $ null originalSchemaContract)
            then filter (\(_, y) -> (contractSchema y) == (contractSchema $ snd $ head originalSchemaContract)) sameNameList
            else []
        --Create a UNION statement for every table that matches the schema of the original contract
        let tableString = map (\table -> "UNION SELECT * FROM \"" <> fromMaybe (name newCachedContract) (resolvedName $ snd table) <> "\"") tableList

        return $ "create or replace view \"" <> (name newCachedContract) <> "\" as select * from \"" <> (name newCachedContract) <> "1\" " <> (T.intercalate " " tableString) <> ";"

  yield viewSt
  --return ()
