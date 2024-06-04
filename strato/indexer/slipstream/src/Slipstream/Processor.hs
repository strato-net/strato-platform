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

module Slipstream.Processor
  ( processTheMessages,
    parseActions,
    )
where

import Bloc.Monad
import Bloc.Server.Utils
import BlockApps.Logging
import qualified BlockApps.SolidVMStorageDecoder as SolidVM
import qualified BlockApps.Solidity.Contract as OLD
import BlockApps.Solidity.Value
import qualified BlockApps.SolidityVarReader as SVR
import Blockchain.Data.AddressStateDB
import Blockchain.Data.TransactionResult
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.Event
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Stream.Action as Action
import Blockchain.Stream.VMEvent
import Control.Lens ((^.))
import Control.Monad (forM, forM_, unless, when)
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.SQL
import Control.Monad.IO.Unlift
import Control.Monad.Trans.Reader
import Control.Monad.Trans.State.Strict hiding (state)
import Data.Either (lefts, rights)
import Data.Foldable (toList)
import Data.Function
import Data.IORef
import qualified Data.Map.Ordered as OMap
import Data.List (foldl', sortOn)
import qualified Data.Map as Map
import Data.Maybe
import Data.Ord (Down (..))
import qualified Data.Set as S
import Data.Text (Text)
import qualified Data.Text as T
import Data.Traversable (for)
import Database.PostgreSQL.Typed (PGConnection)
import SelectAccessible ()
import Slipstream.Data.Action
import Slipstream.Events
import Slipstream.Globals
import Slipstream.Metrics
import Slipstream.OutputData
import Slipstream.QueryFormatHelper
import SolidVM.Model.CodeCollection hiding (contractName)
import qualified SolidVM.Model.Type as SVMType
import Text.Format
import Text.Tools (boringBox, multilineLog)
import Prelude hiding (lookup)

diffNull :: Action.DataDiff -> Bool
diffNull (Action.EVMDiff m) = Map.null m
diffNull (Action.SolidVMDiff m) = Map.null m

mergeDiffs :: Action.DataDiff -> Action.DataDiff -> Action.DataDiff
mergeDiffs (Action.EVMDiff lhs) (Action.EVMDiff rhs) = Action.EVMDiff $ lhs <> rhs
mergeDiffs (Action.SolidVMDiff lhs) (Action.SolidVMDiff rhs) = Action.SolidVMDiff $ lhs <> rhs
mergeDiffs lhs rhs = error $ "Invalid diff combination: " ++ show (lhs, rhs)

data BatchedInserts = BatchedInserts
  { indexInsert :: (ProcessedContract, [T.Text]),
    abstractInserts :: [(ProcessedContract,[T.Text],T.Text, TableColumns)],
    historyInserts :: [ProcessedContract],
    mappingInserts :: [ProcessedMappingRow]
  }
  deriving (Show)

enterBloc2 :: r -> ReaderT r m a -> m a
enterBloc2 = flip runReaderT

matters :: AggregateAction -> Bool
matters AggregateAction {..} =
  (actionType == Action.Create || (not $ diffNull actionStorage))
    && (resolvedCodePtrToSHA actionCodeHash /= emptyHash)

-- assumes all Actions in the list are for the same Account
combineActions :: [AggregateAction] -> AggregateAction
combineActions [] = error "cannot combine 0 actions"
combineActions (x : xs) = foldl' merge x xs
  where
    merge a b =
      b
        { actionStorage = (mergeDiffs `on` actionStorage) b a,
          actionMetadata = (Map.union `on` actionMetadata) b a
        }

splitActions :: [AggregateAction] -> [(Account, [AggregateAction])]
splitActions = partitionWith actionAccount

data ABIID = ABIID
  { aiName :: Text,
    aiChain :: Text
  }
  deriving (Eq, Show)

processedContract ::
  ABIID ->
  Map.Map Text Value ->
  AggregateAction ->
  ProcessedContract
processedContract ABIID {..} state AggregateAction {..} =
  ProcessedContract
    { address = actionAccount ^. accountAddress,
      codehash = actionCodeHash,
      creator = actionCreator,
      root = actionRoot,
      application = actionApplication,
      contractName = aiName,
      chain = aiChain,
      contractData = state,
      blockHash = actionBlockHash,
      blockTimestamp = actionBlockTimestamp,
      blockNumber = actionBlockNumber,
      transactionHash = actionTxHash,
      transactionSender = actionTxSender ^. accountAddress
    }

readPreviousSolidVMState ::
  MonadIO m =>
  IORef Globals ->
  Account ->
  m [(Text, Value)]
readPreviousSolidVMState gref acct = fromMaybe [] <$> getContractState gref acct

rowToInsert ::
  MonadIO m =>
  IORef Globals ->
  ABIID ->
  AggregateAction ->
  OLD.Contract ->
  [(Text, Value)] ->
  m ProcessedContract
rowToInsert gref abiid row cont oldState = do
  let newState = case actionStorage row of
        Action.EVMDiff mp -> SVR.decodeCacheValues cont (flip Map.lookup mp) oldState
        Action.SolidVMDiff mp -> SolidVM.decodeCacheValues mp oldState
  setContractState gref (actionAccount row) newState
  return $ processedContract abiid (Map.fromList $ newState) row

rowToMappings :: MonadIO m => AggregateAction -> m (Map.Map Text Value)
rowToMappings row = do
  let newState = case actionStorage row of
        Action.SolidVMDiff mp -> SolidVM.decodeCacheValuesForMapping mp
        _ -> []
  return $ (Map.fromList $ newState)

processedContractToProcessedMappingRows :: MonadIO m => Map.Map Text Value -> [Text] -> AggregateAction -> ABIID -> m [ProcessedMappingRow]
processedContractToProcessedMappingRows state mapNames row abiid = do
  let valueMappingsMap = Map.filter (\value -> case value of ValueMapping _ -> True; _ -> False) (state)
      onlyRecord = Map.toList (Map.restrictKeys valueMappingsMap (S.fromList mapNames))
      recordVMs = fmap (\(a, value) -> case value of ValueMapping b -> (a, b); _ -> undefined) onlyRecord
  if null valueMappingsMap
    then return $ []
    else do
      let result = concatMap (\(mName, theMap) -> map (\(k, v) -> processedMappingRow mName row abiid (SimpleValue k) v) (Map.toList theMap)) (recordVMs)
      return $ result

rowToHistories ::
  (MonadIO m) =>
  IORef Globals ->
  ABIID ->
  [AggregateAction] ->
  OLD.Contract ->
  [(Text, Value)] ->
  m [ProcessedContract]
rowToHistories _ abiId actions cont oldState = do
  flip evalStateT oldState . forM actions $ \hRow -> do
    modify $ case actionStorage hRow of
      Action.EVMDiff mp -> SVR.decodeCacheValues cont (flip Map.lookup mp)
      Action.SolidVMDiff mp -> SolidVM.decodeCacheValues mp
    newMap <- gets Map.fromList
    return $ processedContract abiId newMap hRow

processedMappingRow :: Text -> AggregateAction -> ABIID -> Value -> Value -> ProcessedMappingRow
processedMappingRow mapping AggregateAction {..} ABIID {..} k v =
  ProcessedMappingRow
    { address = actionAccount ^. accountAddress,
      codehash = actionCodeHash,
      creator = actionCreator,
      root = actionRoot,
      application = actionApplication,
      contractname = aiName,
      mapname = mapping,
      blockHash = actionBlockHash,
      blockTimestamp = actionBlockTimestamp,
      blockNumber = actionBlockNumber,
      transactionHash = actionTxHash,
      transactionSender = actionTxSender ^. accountAddress,
      mapDataKey = k,
      mapDataValue = v
    }

-- Prioritizing with-source actions prevents the issue where updates to contracts
-- at different addresses are lost because the schema has not been seen yet.
withSourceFirst :: (a, [AggregateAction]) -> Down Bool
withSourceFirst = Down . any (Map.member "src" . actionMetadata) . snd

parseActions :: [VMEvent] -> [(Account, [AggregateAction])]
parseActions events' =
  sortOn withSourceFirst
    . splitActions
    . filter matters
    . concatMap (flatten)
    $ [a | NewAction a <- events']

parseEvents :: [VMEvent] -> [AggregateEvent]
parseEvents = concatMap parseEvent
  where
    parseEvent (NewAction a) = mkAggregateEvent a <$> toList (Action._events a)
    parseEvent _ = []
    mkAggregateEvent a e =
      AggregateEvent
        { eventBlockHash = Action._blockHash a,
          eventBlockTimestamp = Action._blockTimestamp a,
          eventBlockNumber = Action._blockNumber a,
          eventTxHash = Action._transactionHash a,
          eventTxSender = Action._transactionSender a,
          eventAbstracts = maybe Map.empty Action._actionDataAbstracts . OMap.lookup (evContractAccount e) $ Action._actionData a,
          eventEvent = e
        }

getMapNamesFromContract :: ContractF () -> [Text]
getMapNamesFromContract c =
  let storageDefs' = c ^. storageDefs
      storageDefsList = Map.toList storageDefs'
      listOfMappings = filter (\(_, vd) -> case (_varType vd) of SVMType.Mapping _ _ _ -> True; _ -> False) storageDefsList
      listOfMappingsWithRecords = filter (\(_, vd) -> _isRecord vd) listOfMappings
   in T.pack . fst <$> listOfMappingsWithRecords

getContractsFromPC :: ProcessedContract -> [Text]
getContractsFromPC pc = Map.keys $ Map.filter isValueContract (contractData pc)
  where
    isValueContract :: Value -> Bool
    isValueContract (ValueContract _) = True
    isValueContract _ = False

processTheMessages ::
  ( MonadLogger m,
    HasSQL m,
    Mod.Accessible (IORef Globals) m
  ) =>
  BlocEnv ->
  PGConnection ->
  [VMEvent] ->
  m [AggregateEvent]
processTheMessages env conn messages = do
  g <- Mod.access (Mod.Proxy @(IORef Globals))

  case length messages of
    0 -> return ()
    1 -> $logInfoS "processTheMessages" "1 message has arrived"
    n -> $logInfoS "processTheMessages" . T.pack $ show n ++ " messages have arrived"

  let changes = parseActions messages
      events' = parseEvents messages
      -- TODO (Dan) : would be nice if we didn't just rip events out at the top level like this
      creates = [(cc, cp, cr, ap, hl, abs', rm) | CodeCollectionAdded cc cp cr ap hl abs' rm <- messages]
      -- delegates = [d | DelegatecallMade d <- messages]
      transactionResults = [tr | NewTransactionResult tr <- messages]

  fkeys' <- forM creates $ \(cc, cp, cr, ap, hl, abstracts', _) -> do
        $logInfoS "processTheMessages" $ "CodeCollection Added: " <> T.pack (format cp) 
        multilineLog "processTheMessages/contracts" $ boringBox $ map show (Map.keys $ cc ^. contracts)

        deferredForeignKeys <- fmap concat $
          forM (Map.toList $ cc ^. contracts) $ \(_, c) -> do
            -- Here we will get the storageDefs attribute of the contract (c) and iterate through the Map of (Text, VariableDecl) and look for VariableDecls that have the last attribute (isRecord) true and thetype are mappings
            -- We will then create a table for each of these mappings and add a foreign key to the main table

            let mapNames = getMapNamesFromContract c

            let historyTableNames = map (historyTableName cr ap) hl
            $logDebugS "processTheMessages/historyTableNames" $ T.pack $ show historyTableNames

            let nameParts@(cr', ap',  n'') = (cr, ap, T.pack $ _contractName c)
            $logInfoS "processTheMessages/Contract Added" $ "ccreator=" <> cr' <> ", app=" <> ap' <> ", name=" <> n''
            multilineLog "processTheMessages/fields" $ boringBox $ map (show) $ Map.toList $ fmap _varType $ c ^. storageDefs

            --Create mapping tables
            deferredForeignKeysForMappings <- fmap concat $
              forM mapNames $ \m -> do
                outputData conn $ createMappingTable g nameParts m --Tables are created

            -- mark

            deferredForeignKeys <- case (_contractType c) of
              AbstractType -> do
                abstractfkeys <- outputData conn $ createExpandAbstractTable g c nameParts abstracts' cc
                outputData' conn $ createExpandHistoryTable True g c cc nameParts
                $logInfoS "processTheMessages/deferredForeignKeys/abstractfkeys" $ T.pack $ show abstractfkeys
                return abstractfkeys
              _ -> do
                indexfkeys <- outputData conn $ createExpandIndexTable g c cc nameParts
                $logInfoS "processTheMessages/deferredForeignKeys/indexfkeys" $ T.pack $ show indexfkeys
                outputData' conn $ createExpandHistoryTable False g c cc nameParts
                return indexfkeys

            $logInfoS "processTheMessages/deferredForeignKeys" $ T.pack $ show deferredForeignKeys


            deferredForeignKeysForEvents <- outputData conn $ createExpandEventTables g c cc nameParts

            return $ deferredForeignKeys ++ deferredForeignKeysForMappings ++ deferredForeignKeysForEvents

        -- forM_ deferredForeignKeys $ \deferredForeignKey -> do
        --   outputData conn $ createForeignIndexesForJoins deferredForeignKey
        pure $ Right deferredForeignKeys
  -- TODO: Add delegatecall indexing back in
  -- dfkeys' <- forM delegates $ \d@(Action.Delegatecall s c' o a) -> do
  --   dels <- getDelegates g s
  --   $logInfoS "processTheMessages" $ "Got delegates for " <> T.pack (format s) <> ": " <> T.pack (show dels)
  --   if c' `elem` dels
  --     then do
  --       $logInfoS "processTheMessages" $ T.pack (format c') <> " was already seen as a delegate of " <> T.pack (format s)
  --       pure $ Right []
  --     else do
  --       $logInfoS "processTheMessages" $ T.pack (format c') <> " was not a delegate of " <> T.pack (format s)
  --       $logInfoS "processTheMessages" $ "Delegatecall made: " <> T.pack (format d)
  --       mStorageContract <- select (Proxy @Contract) s
  --       mCodeContract <- select (Proxy @Contract) c'
  --       mCodeCollection <- select (Proxy @CodeCollection) c' 
  --       deferredForeignKeys <- case (,,) <$> mStorageContract <*> mCodeContract <*> mCodeCollection of
  --         Nothing -> pure []
  --         Just (sc, cc, _') -> do
  --           let c = cc {_contractName = _contractName sc}
  --               mapNames = getMapNamesFromContract c
  --           nameParts <- resolveNameParts o a c
  --           forM_ mapNames $ outputData conn . createMappingTable g nameParts
  --           deferredForeignKeys <- outputData conn $ createExpandIndexTable g c nameParts
  --           outputData' conn $ createExpandHistoryTable g c nameParts
  --           outputData conn $ createExpandEventTables g c nameParts
  --           pure deferredForeignKeys
        -- forM_ deferredForeignKeys $ outputData conn . createForeignIndexesForJoins
  --       addDelegate g s c'
  --       pure $ Right deferredForeignKeys

  let fkeys = rights $ fkeys' -- ++ dfkeys'
      concatFkeys = concat fkeys

  inserts <- enterBloc2 env $ do
    forM changes $ \(acct, actions) -> do
      let row = combineActions actions
      mapM_ recordAction actions
      recordCombinedAction row
      $logDebugS "processTheMessages" $ "Combined Action = " <> formatAction row
      $logDebugS "processTheMessages" $ T.pack $ "the diff is " ++ format (actionStorage row)

      case actionStorage row of
        Action.EVMDiff {} -> pure $ Left "EVM code indexing ignored"
        Action.SolidVMDiff {} -> do
          let cid = maybe "" (T.pack . chainIdString . ChainId) $ (actionAccount row ^. accountChainId)
              name = case actionCodeHash row of
                SolidVMCode name' _ -> name'
                _ -> error "internal error: contract should be SolidVM for SolidVM"
              abiid =
                ABIID
                  { aiName = T.pack name,
                    aiChain = cid
                  }
              cont = error "internal error: contract should be unused for SolidVM"
          $logDebugLS "Contract name is: " $ T.pack $ show name
          oldState <- readPreviousSolidVMState g acct
          indexContract <- rowToInsert g abiid row cont oldState
          let fkeysForThisContract = getContractsFromPC indexContract
          hs <- rowToHistories g abiid actions cont oldState
          let mapNames = actionMappings row
              abstracts = actionAbstracts row -- to get abstract history info, get `actionAbstracts <$> actions`
          --get columns for abstract table
          $logDebugLS "abstractColumns" $ T.pack $ "Getting abstract columns from " ++ (show abstracts)
          abstractColumns <- fmap catMaybes . for (Map.toList abstracts) $ \((_, n'), (cr', ap')) -> do
            let tableName = AbstractTableName cr' ap' n'
                tableNameText = tableNameToDoubleQuoteText tableName
            $logInfoS "Row will be inserted into abstract table: " tableNameText
            mCols <- getTableColumns g tableName
            pure $ (indexContract, fkeysForThisContract, tableNameText,) . map extractTextInsideQuotes <$> mCols
          $logDebugLS "Globals: Recorded Map names are: " . T.pack $ show mapNames ++ " contract: " ++ show (contractName indexContract)
          $logDebugLS "History inserts are: " $ T.pack $ show hs
          stateDiff <- rowToMappings row
          pMappings <- processedContractToProcessedMappingRows stateDiff (mapNames) row abiid --get all mapping rows to insert
          pure . Right $ BatchedInserts (indexContract,fkeysForThisContract) abstractColumns hs pMappings

  forM_ (lefts inserts) $ $logErrorS "processTheMessages"

  -- TODO: might need to group inserts by TableName
  let insertsByCodeHash = rights inserts

  forM_ (rights inserts) $ $logDebugLS "processTheMessages/toInsert"
  
  forM_ insertsByCodeHash $ \ins -> do
    outputData conn $ insertIndexTable $ indexInsert ins
    outputData conn $ insertHistoryTable $ historyInserts ins
    unless ((length (mappingInserts ins) < 1)) $ outputData conn $ insertMappingTable $ mappingInserts ins
    outputData conn $ insertAbstractTable (abstractInserts ins) False -- not historic
    outputData conn $ insertHistoryAbstractTable (abstractInserts ins) (historyInserts ins)

--updating the foreign keys from null
  forM_ insertsByCodeHash $ \ins -> do
    outputData conn $ updateForeignKeysFromNULLAbstract (abstractInserts ins) -- not historic
    outputData conn $ updateForeignKeysFromNULLIndex (indexInsert ins)

  forM_ concatFkeys $ \deferredForeignKey -> do
    outputData conn $ createForeignIndexesForJoins deferredForeignKey

  when ((length creates > 0) && any (\k -> length k > 0) fkeys) $ do
    $logDebugLS "processTheMessages" $ T.pack $ "Updating PostgREST schema cache for " ++ show (sum $ map length fkeys) ++ " foreign key relationships"
    notifyPostgREST conn

  when (length events' > 0) $
    outputData conn $ insertEventTables g events'

  $logInfoS "processTheMessages" . T.pack $ "Inserting " ++ show (length transactionResults) ++ " transaction results"

  forM_ transactionResults $ putTransactionResult

  flushPendingWrites g

  return events'

extractTextInsideQuotes :: T.Text -> T.Text
extractTextInsideQuotes input =
  case T.stripPrefix "\"" input of
    Just rest ->
      case T.break (== '"') rest of
        (extracted, _) -> extracted
    Nothing -> ""
