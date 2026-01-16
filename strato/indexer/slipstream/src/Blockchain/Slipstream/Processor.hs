{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

{-# OPTIONS_GHC -fno-warn-unused-imports #-}
{-# OPTIONS_GHC -fno-warn-redundant-constraints #-}
{-# OPTIONS_GHC -fno-warn-unused-do-bind #-}

module Blockchain.Slipstream.Processor
  ( processTheMessages,
    parseActions,
    )
where

import Bloc.Server.Utils
import BlockApps.Logging
import qualified BlockApps.SolidVMStorageDecoder as SolidVM
import BlockApps.Solidity.Value
import Blockchain.Data.TransactionResult
import Blockchain.DB.SQLDB
import Blockchain.Slipstream.Data.Action
import Blockchain.Slipstream.Data.CirrusTables
import qualified Blockchain.Slipstream.Events as E
import Blockchain.Slipstream.OutputData
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Stream.Action as Action
import qualified Blockchain.Stream.VMEvent as VME
import Conduit
import Control.Lens ((^.))
import Control.Monad (forM, forM_, unless, when, void)
import Control.Monad.Composable.SQL
import Control.Monad.Trans.Reader
import qualified Data.Aeson as JSON
import Data.Either (lefts, rights)
import Data.Foldable (toList)
import Data.Function
import qualified Data.IntMap as I
import qualified Data.Map as Map
import Data.Maybe
import Data.Source
import Data.Text (Text)
import qualified Data.Text as T
import Data.Traversable (for)
--import Database.Persist
import Database.Persist.Postgresql
import Database.Esqueleto.PostgreSQL.JSON
import qualified Database.Persist.Postgresql as SQL
import SolidVM.Model.CodeCollection hiding (contractName, Storage)
import SolidVM.Model.Storable hiding (toList)
import qualified SolidVM.Model.Type as SVMType
import Text.Tools (boringBox, multilineLog)
import Prelude hiding (lookup)
import Blockchain.Slipstream.SolidityValue
import           Blockchain.Slipstream.PostgresqlTypedShim

data BatchedInserts = BatchedInserts
  { indexInsert :: E.ProcessedContract
  , collectionInserts :: [ProcessedCollectionRow]
  }
  deriving (Show)

matters :: AggregateAction -> Bool
matters AggregateAction {} = True -- codePtrToSHA actionCodeHash /= emptyHash


splitActions :: [AggregateAction] -> [(Address, [AggregateAction])]
splitActions = partitionWith actionAddress

processedContract ::
  Map.Map StoragePath BasicValue ->
  AggregateAction ->
  E.ProcessedContract
processedContract state AggregateAction {..} =
  E.ProcessedContract
    { address = actionAddress,
      contractData = state,
      blockHash = actionBlockHash,
      blockTimestamp = actionBlockTimestamp,
      blockNumber = actionBlockNumber
    }

rowToInsert ::
  AggregateAction ->
  E.ProcessedContract
rowToInsert row =
  let newState = case actionStorage row of
        Action.SolidVMDiff mp -> mp
   in processedContract newState row


rowToCollections :: AggregateAction -> Either Text (Map.Map Text Value)
rowToCollections row =
  let newState = case actionStorage row of
        Action.SolidVMDiff mp -> SolidVM.decodeCacheValuesForCollections mp
   in Map.fromList <$> newState

processedContractToProcessedCollectionRows :: Map.Map Text Value -> AggregateAction -> [ProcessedCollectionRow]
processedContractToProcessedCollectionRows state row =
  let extractValues (ValueArrayFixed _ b) = concatMap (\(i, v') -> (\(_, ks, v) -> ("Array", (SimpleValue $ ValueInt False Nothing i):ks, v)) <$> extractValues v') $ zip [0..] b
      extractValues (ValueArrayDynamic b) = concatMap (\(i, v') -> (\(_, ks, v) -> ("Array", (SimpleValue . ValueInt False Nothing $ fromIntegral i):ks, v)) <$> extractValues v') $ I.toList b
      extractValues (ValueMapping b)      = concatMap (\(k, v') -> (\(_, ks, v) -> ("Mapping", (SimpleValue k):ks, v)) <$> extractValues v') $ Map.toList b
      extractValues v                     = [("it don't matter", [], v)]
      recordVMs = concatMap
        (\(a, value) -> mapMaybe
          (\(t, ks, v) -> case ks of
            [] -> Nothing
            _  -> Just (a, t, ks, v)
          ) $ extractValues value
        ) $ Map.toList state
      processRecord (n, t, ks, v) = processedCollectionRow n t row ks v
   in processRecord <$> recordVMs

processedCollectionRow :: Text -> Text -> AggregateAction -> [Value] -> Value ->  ProcessedCollectionRow
processedCollectionRow collection ttype AggregateAction {..} ks v =
  ProcessedCollectionRow
    { address = actionAddress,
      -- codehash = actionCodeHash,
      eventInfo = Nothing,
      collection_name = collection,
      collection_type = ttype,
      blockHash = actionBlockHash,
      blockTimestamp = actionBlockTimestamp,
      blockNumber = actionBlockNumber,
      collectionDataKeys = ks,
      collectionDataValue = v
    }

parseActions :: [VME.VMEvent] -> [(Address, [AggregateAction])]
parseActions events' =
  splitActions
    . filter matters
    . concatMap (flatten)
    $ [a | VME.NewAction a <- events']

parseEvents :: [VME.VMEvent] -> [AggregateEvent]
parseEvents = concatMap parseEvent
  where
    parseEvent (VME.NewAction a) = zipWith (mkAggregateEvent a) [1..] (toList (Action._events a))
    parseEvent _ = []
    mkAggregateEvent a idx e =
      AggregateEvent
        { eventBlockHash = Action._blockHash a,
          eventBlockTimestamp = Action._blockTimestamp a,
          eventBlockNumber = Action._blockNumber a,
          eventTxSender = Action._transactionSender a,
          eventEvent = e,
          eventIndex = idx
        }

getCollectionsFromContract :: ContractF () -> [(T.Text, [SVMType.Type], SVMType.Type)] -- (collection name, key type(s), value type)
getCollectionsFromContract = mapMaybe (uncurry filterAndExtract) . Map.toList . _storageDefs
  where filterAndExtract name vd = if not (_isRecord vd) then Nothing else case extractKeys (_varType vd) of
          ([], _) -> Nothing
          (ks, v) -> Just (T.pack name, ks, v)
        extractKeys (SVMType.Array entry _)     = let (ks, v) = extractKeys entry in ((SVMType.Int Nothing Nothing):ks, v)
        extractKeys (SVMType.Mapping _ k entry) = let (ks, v) = extractKeys entry in (k:ks, v)
        extractKeys v                           = ([], v)

processTheMessages ::
  ( MonadIO m
  , MonadLogger m
  ) =>
  [VME.VMEvent] ->
  ConduitM () (Either TransactionResult SlipstreamQuery) m [AggregateEvent]
processTheMessages messages = do
  case length messages of
    0 -> return ()
    1 -> $logInfoS "processTheMessages" "1 message has arrived"
    n -> $logInfoS "processTheMessages" . T.pack $ show n ++ " messages have arrived"

  let changes = parseActions messages
      events' = parseEvents messages
      -- TODO (Dan) : would be nice if we didn't just rip events out at the top
      -- level like this
      creates =
        [(cc, cr) | VME.CodeCollectionAdded cc cr <- messages]
      delegatecalls = concatMap toList
        [Action._delegatecalls a | VME.NewAction a <- messages]
      transactionResults = [tr | VME.NewTransactionResult tr <- messages]

  fkeys <- mapOutput Right . fmap concat . forM creates $ \(cc, cr) -> do
    $logInfoS "processTheMessages" $ "CodeCollection Added"
    multilineLog "processTheMessages/contracts" $ boringBox $ map show (Map.keys $ cc ^. contracts)

    fmap concat . forM (filter (_isContractRecord . snd) . Map.toList $ cc ^. contracts) $ \(_, c) -> do
      -- Here we will get the storageDefs attribute of the contract (c)
      -- and iterate through the Map of (Text, VariableDecl) and look for
      -- VariableDecls that have the last attribute (isRecord) true and
      -- thetype are mappings We will then create a table for each of
      -- these collections and add a foreign key to the main table

      let collectionNamesAndTypes = getCollectionsFromContract c
      $logInfoS "processTheMessages/collectionNamesAndTypes" $ T.pack $ show collectionNamesAndTypes

      let nameParts@(cr', n'') = (cr, T.pack $ _contractName c)
      $logInfoS "processTheMessages/Contract Added" $ "ccreator=" <> cr' <> ", name=" <> n''
      multilineLog "processTheMessages/fields" $ boringBox $ map (show) $ Map.toList $ fmap _varType $ c ^. storageDefs

      -- Create collection tables
      let cc' = SourceAnnotation (initialPosition "") (initialPosition "") () <$ cc
      inherited <- case getInheritedContracts cc' (_contractName c) of
        Left err -> do
          $logWarnS "processTheMessages" $ "Failed to get inherited contracts for " <> T.pack (_contractName c) <> ": " <> T.pack (show err)
          pure []
        Right inheritedContracts -> pure $ map (T.pack . _contractName) inheritedContracts
      indexFkeys <- createIndexTable c cc nameParts inherited
      collectionFkeys <- catMaybes <$> traverse (createCollectionTable nameParts c cc inherited) collectionNamesAndTypes
      eventFkeys <- createExpandEventTables c cc nameParts inherited
      pure $ indexFkeys ++ collectionFkeys ++ eventFkeys

  inserts <- fmap concat $ do
    forM changes $ \(_, actions) -> do
      forM actions $ \(row) -> do
        case actionStorage row of
          Action.SolidVMDiff {} -> do
            let indexContract = rowToInsert row
            --get columns for abstract table
            $logDebugLS "History inserts are: " $ T.pack $ show indexContract
            for (rowToCollections row) $ \stateDiff -> do
              let pCollections = processedContractToProcessedCollectionRows stateDiff row --get all collection rows to insert
              pure $ BatchedInserts indexContract pCollections

  forM_ (lefts inserts) $ $logErrorS "processTheMessages"

  -- TODO: might need to group inserts by TableName
  let insertsByCodeHash = rights inserts

  forM_ (rights inserts) $ $logDebugLS "processTheMessages/toInsert"

  mapOutput Right $ do
    forM_ insertsByCodeHash $ \ins -> do
--      lift $ insertIndexTable2 $ insertToStorage $ indexInsert ins
      insertIndexTable $ indexInsert ins
      unless (null $ collectionInserts ins) $
        insertCollectionTable $ collectionInserts ins

    forM_ delegatecalls insertDelegatecall

  let processedEventArrays = concatMap aggEventToCollectionRows events'

  when (not (null events')) $ do
    mapOutput Right $ pipeInsertGlobalEventTable events'
    unless (null processedEventArrays) $
      mapOutput Right $ insertCollectionTable processedEventArrays

  when (not $ null fkeys) $ do
    $logDebugLS "processTheMessages" $ T.pack $ "Updating PostgREST schema cache for " ++ show (length fkeys) ++ " foreign keys"
    mapOutput Right $ createFkeyFunctions fkeys
    mapOutput Right $ notifyPostgREST

  $logInfoS "processTheMessages" . T.pack $
    "Inserting " ++ show (length transactionResults) ++ " transaction results"

  yieldMany $ Left <$> transactionResults

  return events'
{-
insertToStorage :: E.ProcessedContract -> Storage
insertToStorage E.ProcessedContract{..} = Storage address blockHash (show blockTimestamp) blockNumber
                                          (JSONB $ JSON.toJSON contractData)

insertIndexTable2 :: (HasSQLDB m, PersistEntityBackend Storage ~ SqlBackend) =>
                     Storage -> m ()
insertIndexTable2 record = do
--  putTransactionResult processedContract'
  sqlQuery $ SQL.insertMany [record]
--  sqlQuery $ insertMany [processedContract']
  return ()
-}
