{-# LANGUAGE
    FlexibleContexts
  , OverloadedStrings
  , QuasiQuotes
  , RecordWildCards
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
import           Text.RawString.QQ
import           UnliftIO.IORef

import           BlockApps.Ethereum

import Slipstream.Events
import Slipstream.Globals
import Slipstream.Metrics
import Slipstream.Options
import Slipstream.SolidityValue

tshow :: Show a => a -> Text
tshow = T.pack . show

typeText :: SolidityValue -> Text
typeText (SolidityValueAsString _) = "text"
typeText (SolidityNum _) = "bigint"
typeText (SolidityBool _) = "bool"
typeText _ = "jsonb"

csv :: [Text] -> Text
csv = T.intercalate ",\n    "

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
solidityValueToText (SolidityArray x)         = escapeSingleQuotes . decodeUtf8 . BL.toStrict $ encode x
solidityValueToText (SolidityObject x)        = escapeSingleQuotes . decodeUtf8 . BL.toStrict $ encode x

escapeSingleQuotes :: Text -> Text
escapeSingleQuotes = T.replace "\'" "\'\'"

escapeDoubleQuotes :: Text -> Text
escapeDoubleQuotes = T.replace "\"" "\\\""

escapeQuotes :: Text -> Text
escapeQuotes = escapeSingleQuotes . escapeDoubleQuotes

tableColumns :: [(Text, SolidityValue)] -> [Text]
tableColumns = map go
  where go (x,y) = let z = wrapDoubleQuotes $ escapeQuotes x
                   in T.concat [z, " ", typeText y]

tableUpsert :: [Text] -> Text
tableUpsert = csv . map go
  where go x = let y = wrapDoubleQuotes $ escapeQuotes x
                in wrap1 y " = excluded."

cirrusInfo :: PGDatabase
cirrusInfo = PGDatabase
  { pgDBHost = flags_pghost :: HostName
  , pgDBPort = PortNumber . fromIntegral $ flags_pgport
  , pgDBUser = BC.pack flags_pguser :: B.ByteString
  , pgDBPass = BC.pack flags_password :: B.ByteString
  , pgDBName = BC.pack flags_database :: B.ByteString
  , pgDBDebug = False
  , pgDBLogMessage = infoM "pglog" . show . PGError
  , pgDBParams = [("Timezone", "UTC")]
  }

dbInsert :: MonadIO m => PGConnection -> Text -> m ()
dbInsert conn insrt = liftIO
                    . handle handlePostgresError
                    . void
                    . pgQuery conn
                    . rawPGSimpleQuery $! encodeUtf8 insrt

isFunction :: Value -> Bool
isFunction ValueFunction{} = False
isFunction _ = True

handlePostgresError :: (MonadIO m) => SomeException -> m ()
handlePostgresError = liftIO . errorM "handlePGError" . show

outputData :: ( MonadIO m)
           => PGConnection
           -> ConduitM () Text m ()
           -> m ()
outputData conn c = runConduit $ c
                              .| iterMC (liftIO . debugM "outputData" . T.unpack)
                              .| mapM_C (dbInsert conn)

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

createInserts :: (MonadIO m)
              => IORef Globals
              -> [ProcessedContract]
              -> ConduitM () Text m ()
createInserts globalsIORef contracts = do
  unless (null contracts) $ do
    let contract = head contracts
    createIndexTable globalsIORef contract
    createHistoryTable globalsIORef contract
    insertIndexTable globalsIORef contracts
    insertHistoryTable globalsIORef contracts

createInsertIndexTable
  :: (MonadIO m)
  => IORef Globals
  -> [ProcessedContract]
  -> ConduitM () Text m ()
createInsertIndexTable g cs = do
  unless (null cs) $ do
    let c = head cs
    createIndexTable g c
    insertIndexTable g cs

createInsertHistoryTable
  :: (MonadIO m)
  => IORef Globals
  -> [ProcessedContract]
  -> ConduitM () Text m ()
createInsertHistoryTable g cs = do
  unless (null cs) $ do
    let c = head cs
    createHistoryTable g c
    insertHistoryTable g cs

createInsertFunctionHistoryTable
  :: (MonadIO m)
  => IORef Globals
  -> [ProcessedContract]
  -> ConduitM () Text m ()
createInsertFunctionHistoryTable _ cs = do
  unless (null cs) $ do
    -- TODO: implement function history
    -- let c = head cs
    -- createFunctionHistoryTable g c
    -- insertFunctionHistoryTable g cs
    pure ()

createIndexTable :: (MonadIO m)
                 => IORef Globals
                 -> ProcessedContract
                 -> ConduitM () Text m ()
createIndexTable globalsIORef contract = do
  globals <- readIORef globalsIORef
  let hashVal = codehash contract
      contractAlreadyCreated = hashVal `Set.member` createdContracts globals

  --When contract hasn't been written to "contract" table and indexing table doesn't exist
  liftIO . debugM "createIndexTable" . show $
    T.intercalate " " [ "In createIndexTable,"
                      , tshow hashVal
                      , "contractAlreadyCreated ="
                      , tshow contractAlreadyCreated
                      ]
  unless contractAlreadyCreated $ do
    incNumTables
    yield $ insertContractTableQuery contract
    yield $ createIndexTableQuery contract
    setContractCreated globalsIORef hashVal

createHistoryTable :: (MonadIO m)
                   => IORef Globals
                   -> ProcessedContract
                   -> ConduitM () Text m ()
createHistoryTable globalsIORef contract = do
  let hashVal = codehash contract
  history <- isHistoric globalsIORef hashVal
  when history $ do
    incNumHistoryTables
    yield $ createHistoryTableQuery contract

insertIndexTable :: (MonadIO m)
                 => IORef Globals
                 -> [ProcessedContract]
                 -> ConduitM () Text m ()
insertIndexTable _ [] = error "insertIndexTable: unhandled empty list"
insertIndexTable globalsIORef contracts@(x:_) = do
  let hashVal = codehash x
  index <- shouldIndex globalsIORef hashVal
  when index . yield $ insertIndexTableQuery contracts

insertHistoryTable :: (MonadIO m)
                   => IORef Globals
                   -> [ProcessedContract]
                   -> ConduitM () Text m ()
insertHistoryTable _ [] = error "insertHistoryTable: unhandled empty list"
insertHistoryTable globalsIORef contracts@(x:_) = do
  let hashVal = codehash x
  history <- isHistoric globalsIORef hashVal
  when history . yield $ insertHistoryTableQuery contracts

insertContractTableQuery :: ProcessedContract -> Text
insertContractTableQuery ProcessedContract{..} =
  let conVals = wrapAndEscape . map escapeQuotes $
        [ T.pack $ keccak256String codehash
        , contractName
        , abi
        , chain
        ]
   in T.concat
        [ "INSERT INTO contract (\"codeHash\", contract, abi, \"chainId\")\n  VALUES "
        , conVals
        , "\n  ON CONFLICT DO NOTHING;"
        ]

createIndexTableQuery :: ProcessedContract -> Text
createIndexTableQuery contract =
  let tableName = escapeQuotes $ contractName contract
      list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData contract
   in T.concat
        [ "CREATE TABLE IF NOT EXISTS " , wrapDoubleQuotes tableName , " ("
        , csv $ ["address text", "\"chainId\" text", "block_hash text", "block_timestamp text",
               "block_number text", "transaction_hash text", "transaction_sender text",
               "transaction_function_name text"] ++ tableColumns list
        , ",\n  CONSTRAINT "
        , wrapDoubleQuotes (tableName <> "_pkey")
        , "\n  PRIMARY KEY (address, \"chainId\") );"
        ]

createHistoryTableQuery :: ProcessedContract -> Text
createHistoryTableQuery contract =
  let tableName = escapeQuotes $ contractName contract
      toHistory = (<>) "history@"
      historyName = toHistory tableName
      list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData contract
   in T.concat
        [ "CREATE TABLE IF NOT EXISTS ", wrapDoubleQuotes historyName, " ("
        , csv $ ["address text", "\"chainId\" text", "block_hash text", "block_timestamp text",
                 "block_number text", "transaction_hash text", "transaction_sender text",
                 "transaction_function_name text"] ++ tableColumns list
        , ");"
        ]

insertIndexTableQuery :: [ProcessedContract] -> Text
insertIndexTableQuery [] = error "insertIndexTableQuery: unhandled empty list"
insertIndexTableQuery contracts@(x:_) =
  let tableName = escapeQuotes $ contractName x
      list = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData x
      keySt  = wrapAndEscapeDouble . map escapeQuotes $ baseTableColumns ++ map fst list
      transactionFuncName = fromMaybe "" . fmap functioncalldataName . functionCallData
      baseVals = [ tshow . address
                 , chain
                 , T.pack . keccak256String . blockHash
                 , tshow . blockTimestamp
                 , tshow . blockNumber
                 , T.pack . keccak256String . transactionHash
                 , tshow . transactionSender
                 ]
      tableVals = baseVals ++ [escapeQuotes . transactionFuncName]
      vals = flip map contracts $ \row ->
        let rowList = Map.toList $ Map.map valueToSolidityValue $ Map.filter isFunction $ contractData row
         in wrapAndEscape $ map ($ row) tableVals ++ map solidityValueToText (snd <$> rowList)
      inserts = csv vals
   in T.concat
        [ "INSERT INTO "
        , wrapDoubleQuotes tableName
        , " "
        , keySt
        , "\n  VALUES "
        , inserts
        , [r|
  ON CONFLICT (address, "chainId") DO UPDATE SET
    address = excluded.address,
    "chainId" = excluded."chainId",
    block_hash = excluded.block_hash,
    block_timestamp = excluded.block_timestamp,
    block_number = excluded.block_number,
    transaction_hash = excluded.transaction_hash,
    transaction_sender = excluded.transaction_sender,
    transaction_function_name = excluded.transaction_function_name|]
        , if null list then "" else ",\n    "
        , tableUpsert $ map fst list
        , ";"
        ]

insertHistoryTableQuery :: [ProcessedContract] -> Text
insertHistoryTableQuery [] = error "insertHistoryTableQuery: unhandled empty list"
insertHistoryTableQuery contracts@(x:_) =
  let tableName = escapeQuotes $ contractName x
      toHistory = (<>) "history@"
      historyName = toHistory tableName
      list = Map.toList . Map.map valueToSolidityValue . Map.filter isFunction $ contractData x
      keySt  = wrapAndEscapeDouble . map escapeQuotes $ baseTableColumns ++ map fst list
      transactionFuncName = fromMaybe "" . fmap functioncalldataName . functionCallData
      baseVals = [ tshow . address
                 , chain
                 , T.pack . keccak256String . blockHash
                 , tshow . blockTimestamp
                 , tshow . blockNumber
                 , T.pack . keccak256String . transactionHash
                 , tshow . transactionSender
                 ]
      tableVals = baseVals ++ [escapeQuotes . transactionFuncName]
      vals = flip map contracts $ \row ->
        let rowList = Map.toList . Map.map valueToSolidityValue . Map.filter isFunction $ contractData row
         in wrapAndEscape $ map ($ row) tableVals ++ map solidityValueToText (snd <$> rowList)
      inserts = csv vals
   in T.concat $
        [ "INSERT INTO "
        , wrapDoubleQuotes historyName
        , " "
        , keySt
        , "\n  VALUES "
        , inserts
        , ";"
        ]
