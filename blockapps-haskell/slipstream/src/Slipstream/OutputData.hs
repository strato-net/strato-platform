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
import qualified Data.Map                        as Map
import           Data.Maybe                      (fromMaybe)
import           Data.Monoid                     ((<>))
import qualified Data.Set                        as Set
import           Data.Text                       (Text)
import qualified Data.Text                       as T
import           Data.Text.Encoding              (decodeUtf8, encodeUtf8)
import           Database.PostgreSQL.Typed
import           Database.PostgreSQL.Typed.Query
import           Network
import           System.Log.Logger
import           UnliftIO.IORef

import           BlockApps.Ethereum

import Slipstream.Events
import Slipstream.Globals
import Slipstream.Metrics
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

csv :: [Text] -> Text
csv = T.intercalate ", "

wrap :: Text -> Text -> Text -> Text
wrap b e x = T.concat [b, x, e]

wrap1 :: Text -> Text -> Text
wrap1 t = wrap t t

wrapSingleQuotes :: Text -> Text
wrapSingleQuotes = wrap1 "\'"

wrapDoubleQuotes :: Text -> Text
wrapDoubleQuotes = wrap1 "\""

wrapParens :: Text -> Text
wrapParens = wrap "(" ")"

wrapAndEscape :: [Text] -> Text
wrapAndEscape = wrapParens . csv . map wrapSingleQuotes

wrapAndEscapeDouble :: [Text] -> Text
wrapAndEscapeDouble = wrapParens . csv . map wrapDoubleQuotes

solidityValueToText :: SolidityValue -> Text
solidityValueToText (SolidityValueAsString x) = escapeQuotes x
solidityValueToText (SolidityBool x)          = tshow x
solidityValueToText (SolidityNum x )          = tshow x
solidityValueToText (SolidityBytes x)         = escapeQuotes $ tshow x
solidityValueToText (SolidityArray x)         = decodeUtf8 . BL.toStrict $ encode x
solidityValueToText (SolidityObject x)        = decodeUtf8 . BL.toStrict $ encode x

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

tableColumns :: [(Text, SolidityValue)] -> Text
tableColumns [] = ""
tableColumns [(x, y)] = T.concat [wrapDoubleQuotes x, " ", typeText y]
tableColumns ((x, y):es) = T.concat [wrapDoubleQuotes x, " ", typeText y, ", ", tableColumns es]

tableUpsert :: [(Text, SolidityValue)] -> Text
tableUpsert [] = ""
tableUpsert [(x, _)] = T.concat [wrapDoubleQuotes x, " = excluded.", wrapDoubleQuotes x]
tableUpsert ((x, _):es) = T.concat [wrapDoubleQuotes x, " = excluded.", wrapDoubleQuotes x,  ", ", tableUpsert es]

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

baseColumns :: [Text]
baseColumns = [ "address"
              , "chainId"
              , "block_hash"
              , "block_timestamp"
              , "block_number"
              , "transaction_hash"
              , "transaction_sender"
              ]

baseTableColumns :: [Text]
baseTableColumns = baseColumns ++ ["transaction_function_name"]

createInserts :: (MonadIO m, MonadBase IO m) => IORef Globals -> ConduitM [ProcessedContract] Text m ()
createInserts globalsIORef = do
  metadata <- fromMaybe (error "createInserts called without contracts") <$> await
  unless (null metadata) $ do
    let firstContract = head metadata
    let hashVal = codehash firstContract
    globals <- readIORef globalsIORef
    let contractAlreadyCreated = hashVal `Set.member` createdContracts globals
    let tableName = contractName firstContract
        functionTableName = tableName <> "." <> transactionFuncName firstContract
        toHistory = (<>) "history@"
        historyName = toHistory tableName
        functionHistoryName = toHistory functionTableName
    history <- isHistoric globalsIORef hashVal

    let list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData firstContract
        funcList = transactionInput firstContract ++ transactionOutput firstContract
    let comma = if null list
                  then ""
                  else ", "
    let fcomma = if null funcList
                   then ""
                   else ", "

    let keySt  = wrapAndEscapeDouble $ baseTableColumns ++ map fst list
        fKeySt = wrapAndEscapeDouble $ baseColumns ++ map fst funcList

    liftIO . debugM "createInserts" . show $ T.intercalate " " ["In convertRet,", tshow hashVal, "contractAlreadyCreated =", tshow contractAlreadyCreated]

    historicContracts <- getHistoryList globalsIORef
    liftIO . debugM "historicContracts" $ show historicContracts

    --When contract hasn't been written to "contract" table and indexing table doesn't exist
    when (not $ contractAlreadyCreated) $ do
        incNumTables
        let conVals = wrapAndEscape [T.pack $ keccak256String $ codehash firstContract, contractName firstContract, abi firstContract, chain firstContract]
        let conIns = T.concat ["insert into contract (\"codeHash\", contract, abi, \"chainId\") values ", conVals, " ON CONFLICT DO NOTHING;"]
        yield conIns
        yield $ T.concat
          [ "create table if not exists "
          , wrapDoubleQuotes tableName
          , " (address text, \"chainId\" text, block_hash text, block_timestamp text, block_number text, transaction_hash text, transaction_sender text, transaction_function_name text"
          , comma
          , tableColumns list
          , ", CONSTRAINT "
          , wrapDoubleQuotes (tableName <> "_pkey")
          , " PRIMARY KEY (address, \"chainId\") );"
          ]

        when history $ do
          incNumHistoryTables
          yield $ T.concat
            [ "create table if not exists "
            , wrapDoubleQuotes historyName
            , " (address text, \"chainId\" text, block_hash text, block_timestamp text, block_number text, transaction_hash text, transaction_sender text, transaction_function_name text"
            , comma
            , tableColumns list
            , ");"
            ]

        void $ writeIORef globalsIORef globals{createdContracts=Set.insert hashVal (createdContracts globals)}

    when history $ do
      yield $ T.concat
        [ "create table if not exists "
        , wrapDoubleQuotes functionHistoryName
        , " (address text, \"chainId\" text, block_hash text, block_timestamp text, block_number text, transaction_hash text, transaction_sender text"
        , fcomma
        , tableColumns funcList
        , ");"
        ]

    let baseVals = [ tshow . address
                   , chain
                   , T.pack . keccak256String . blockHash
                   , tshow . blockTimestamp
                   , tshow . blockNumber
                   , T.pack . keccak256String . transactionHash
                   , tshow . transactionSender
                   ]
        tableVals = baseVals ++ [transactionFuncName]

    let vals = flip map metadata $ \row ->
          let rowList = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData row
          in wrapAndEscape $ map ($ row) tableVals ++ map solidityValueToText (snd <$> rowList)
    let inserts = csv vals

    let fvals = flip map metadata $ \row ->
          let rowList = map snd $ transactionInput row ++ transactionOutput row
          in wrapAndEscape $ map ($ row) baseVals ++ map solidityValueToText rowList
    let finserts = csv fvals

    when history $ do
      yield $ T.intercalate " " ["insert into", wrapDoubleQuotes historyName, keySt, "values", inserts, ";"]
      yield $ T.intercalate " " ["insert into", wrapDoubleQuotes functionHistoryName, fKeySt, "values", finserts, ";"]

    index <- shouldIndex globalsIORef hashVal
    when index $ do
      yield $ T.concat
        [ "insert into "
        , wrapDoubleQuotes tableName
        , " "
        , keySt
        , " values "
        , inserts
        , " on conflict (address, \"chainId\") do update set address = excluded.address, \"chainId\" = excluded.\"chainId\", "
        , "block_hash = excluded.block_hash, block_timestamp = excluded.block_timestamp, block_number = excluded.block_number, "
        , "transaction_hash = excluded.transaction_hash, transaction_sender = excluded.transaction_sender, "
        , "transaction_function_name = excluded.transaction_function_name"
        , comma
        , (tableUpsert list)
        , ";"
        ]
