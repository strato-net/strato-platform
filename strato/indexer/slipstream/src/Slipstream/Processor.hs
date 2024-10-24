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
import qualified Blockchain.Stream.VMEvent as VME
import Control.Lens ((^.))
import Control.Monad (forM, forM_, unless, when)
-- import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.SQL
import Control.Monad.IO.Unlift
import Control.Monad.Trans.Reader
-- import Control.Monad.Trans.State.Strict hiding (state)
import Data.Either (lefts, rights)
import Data.Foldable (toList)
import Data.Function
-- import Data.IORef
import qualified Data.IntMap as I
import qualified Data.Map.Ordered as OMap
import Data.List (sortOn)
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
import qualified Slipstream.Events as E
import Slipstream.OutputData
import Slipstream.Metrics (recordAction)
import Slipstream.QueryFormatHelper
import SolidVM.Model.CodeCollection hiding (contractName)
import qualified SolidVM.Model.Type as SVMType
import Text.Format
import Text.Tools (boringBox, multilineLog)
import Prelude hiding (lookup)

diffNull :: Action.DataDiff -> Bool
diffNull (Action.EVMDiff m) = Map.null m
diffNull (Action.SolidVMDiff m) = Map.null m

data BatchedInserts = BatchedInserts
  { indexInsert :: (E.ProcessedContract, [T.Text]),
    abstractInserts :: [(E.ProcessedContract,[T.Text],T.Text, TableColumns)],
    historyInserts :: [E.ProcessedContract],
    collectionInserts :: [ProcessedCollectionRow]
  }
  deriving (Show)

enterBloc2 :: r -> ReaderT r m a -> m a
enterBloc2 = flip runReaderT

matters :: AggregateAction -> Bool
matters AggregateAction {..} =
  (actionType == Action.Create || (not $ diffNull actionStorage))
    && (resolvedCodePtrToSHA actionCodeHash /= emptyHash)


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
  E.ProcessedContract
processedContract ABIID {..} state AggregateAction {..} =
  E.ProcessedContract
    { address = actionAccount ^. accountAddress,
      codehash = actionCodeHash,
      creator = actionCreator,
      cc_creator = actionCCCreator,
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

-- readPreviousSolidVMState ::
--   MonadIO m =>
--   IORef Globals ->
--   Account ->
--   m [(Text, Value)]
-- readPreviousSolidVMState gref acct = fromMaybe [] <$> getContractState gref acct

rowToInsert ::
  MonadIO m =>
  ABIID ->
  AggregateAction ->
  OLD.Contract ->
  m E.ProcessedContract
rowToInsert abiid row cont =
  let newState = case actionStorage row of
        Action.EVMDiff mp -> SVR.decodeCacheValues cont (flip Map.lookup mp) []
        Action.SolidVMDiff mp -> SolidVM.decodeCacheValues mp
  -- setContractState gref (actionAccount row) newState
  in return $ processedContract abiid (Map.fromList $ newState) row


rowToCollections :: MonadIO m => AggregateAction -> m (Map.Map Text Value)
rowToCollections row = do
  let newState = case actionStorage row of
        Action.SolidVMDiff mp -> SolidVM.decodeCacheValuesForCollections mp
        _ -> [] 
  return $ (Map.fromList $ newState)

processedContractToProcessedCollectionRows :: MonadIO m => Map.Map Text Value -> [Text] -> AggregateAction -> ABIID -> Maybe Text ->m [ProcessedCollectionRow]
processedContractToProcessedCollectionRows state mapAndArrayNames row abiid cregator = do
  let valueCollectionsMap = Map.filter (\value -> case value of 
                                                      ValueMapping _ -> True 
                                                      ValueArrayFixed _ _ -> True 
                                                      ValueArrayDynamic _ -> True 
                                                      _ -> False) state
      onlyRecord = Map.toList (Map.restrictKeys valueCollectionsMap (S.fromList mapAndArrayNames))
      recordVMs = fmap (\(a, value) -> case value of 
                                    ValueMapping b -> (a, Left b) 
                                    ValueArrayFixed _ b -> (a, Right (Left b)) 
                                    ValueArrayDynamic b -> (a, Right (Right b)) 
                                    _ -> undefined) onlyRecord
  if null valueCollectionsMap  
    then return $ []
    else do
      let result = concatMap processRecord recordVMs
          processRecord :: (Text, Either (Map.Map SimpleValue Value) (Either [Value] (I.IntMap Value))) -> [ProcessedCollectionRow]
          processRecord (mName, value) = 
            case value of
              Left theMap -> 
                map (\(k, v) -> processedCollectionRow mName (T.pack "Mapping") row abiid cregator (SimpleValue k) v) (Map.toList theMap)
              Right (Left arrayValues) -> 
                map (processArrayFixed mName row abiid cregator) (zip [0..] arrayValues)
              Right (Right intMapValues) -> 
                map (processArrayDynamic mName row abiid cregator) (I.toList intMapValues)
      return result


processedCollectionRow :: Text -> Text -> AggregateAction -> ABIID -> Maybe Text -> Value -> Value ->  ProcessedCollectionRow
processedCollectionRow collection ttype AggregateAction {..} ABIID {..} cregator k v =
  ProcessedCollectionRow
    { address = actionAccount ^. accountAddress,
      -- codehash = actionCodeHash,
      creator = actionCreator,
      cc_creator = cregator,
      root = actionRoot,
      application = actionApplication,
      contractname = aiName,
      eventInfo = Nothing,
      collectionname = collection,
      collectiontype = ttype,
      blockHash = actionBlockHash,
      blockTimestamp = actionBlockTimestamp,
      blockNumber = actionBlockNumber,
      transactionHash = actionTxHash,
      transactionSender = actionTxSender ^. accountAddress,
      collectionDataKey = k,
      collectionDataValue = v 
    }

processArrayFixed :: Text -> AggregateAction -> ABIID -> Maybe Text -> (Int, Value) -> ProcessedCollectionRow
processArrayFixed mName row abiid cregator (index, value) =
  processedCollectionRow mName (T.pack "Array") row abiid cregator (SimpleValue (ValueInt False Nothing (fromIntegral index))) value

processArrayDynamic :: Text -> AggregateAction -> ABIID -> Maybe Text -> (Int, Value) -> ProcessedCollectionRow
processArrayDynamic mName row abiid cregator (index, value) =
  processedCollectionRow mName (T.pack "Array") row abiid cregator (SimpleValue (ValueInt False Nothing (fromIntegral index))) value

-- Prioritizing with-source actions prevents the issue where updates to contracts
-- at different addresses are lost because the schema has not been seen yet.
withSourceFirst :: (a, [AggregateAction]) -> Down Bool
withSourceFirst = Down . any (Map.member "src" . actionMetadata) . snd

parseActions :: [VME.VMEvent] -> [(Account, [AggregateAction])]
parseActions events' =
  sortOn withSourceFirst
    . splitActions
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
          eventTxHash = Action._transactionHash a,
          eventTxSender = Action._transactionSender a,
          eventAbstracts = maybe Map.empty Action._actionDataAbstracts . OMap.lookup (evContractAccount e) $ Action._actionData a,
          eventEvent = e, 
          eventIndex = idx
        }

getMappingNamesFromContract :: ContractF () -> [Text]
getMappingNamesFromContract c =
  let storageDefs' = c ^. storageDefs
      storageDefsList = Map.toList storageDefs'
      listOfMappings = filter (\(_, vd) -> case (_varType vd) of SVMType.Mapping _ _ _-> True; _ -> False) storageDefsList
      listOfMappingsWithRecords = filter (\(_, vd) -> _isRecord vd) listOfMappings
      listOfCollections = listOfMappingsWithRecords
   in T.pack . fst <$> listOfCollections

getArrayNamesFromContract :: ContractF () -> Map.Map T.Text SVMType.Type
getArrayNamesFromContract c =
  let storageDefs' = c ^. storageDefs
      storageDefsList = Map.toList storageDefs'
      listOfArraysWithTypename = map (\(name, vd) -> case (_varType vd) of
                                                       SVMType.Array entry _ -> Just (T.pack name, entry)
                                                       _ -> Nothing) storageDefsList
   in Map.fromList $ catMaybes listOfArraysWithTypename

getContractsFromPC :: E.ProcessedContract -> [Text]
getContractsFromPC pc = Map.keys $ Map.filter isValueContract (E.contractData pc)
  where
    isValueContract :: Value -> Bool
    isValueContract (ValueContract _) = True
    isValueContract _ = False

-- Function to duplicate each collection row for each parent, changing the contract name, and include the original
duplicateForParentsAndIncludeOriginal :: [ProcessedCollectionRow] -> [(Text,Text,Text)] -> [ProcessedCollectionRow]
duplicateForParentsAndIncludeOriginal collections parentz = concatMap duplicateForSingle collections
  where
    duplicateForSingle :: ProcessedCollectionRow -> [ProcessedCollectionRow]
    duplicateForSingle row = row : [ row { creator = c, application = a, contractname = n } | (c,a,n) <- parentz ]

processTheMessages ::
  ( MonadLogger m,
    HasSQL m
  ) =>
  BlocEnv ->
  PGConnection ->
  [VME.VMEvent] ->
  m [AggregateEvent]
processTheMessages env conn messages = do
  case length messages of
    0 -> return ()
    1 -> $logInfoS "processTheMessages" "1 message has arrived"
    n -> $logInfoS "processTheMessages" . T.pack $ show n ++ " messages have arrived"

  let changes = parseActions messages
      events' = parseEvents messages
      -- TODO (Dan) : would be nice if we didn't just rip events out at the top level like this
      creates = [(cc, cp, cr, ap, hl, abs', rm) | VME.CodeCollectionAdded cc cp cr ap hl abs' rm <- messages]
      -- delegates = [d | DelegatecallMade d <- messages]
      transactionResults = [tr | VME.NewTransactionResult tr <- messages]

  fkeys' <- outputDataDedup conn . forM creates $ \(cc, cp, cr, ap, hl, abstracts', _) -> do
        $logInfoS "processTheMessages" $ "CodeCollection Added: " <> T.pack (format cp) 
        multilineLog "processTheMessages/contracts" $ boringBox $ map show (Map.keys $ cc ^. contracts)

        deferredForeignKeys <- fmap concat $
          forM (Map.toList $ cc ^. contracts) $ \(_, c) -> do
            -- Here we will get the storageDefs attribute of the contract (c) and iterate through the Map of (Text, VariableDecl) and look for VariableDecls that have the last attribute (isRecord) true and thetype are mappings
            -- We will then create a table for each of these collections and add a foreign key to the main table

            let mappingNames = getMappingNamesFromContract c  
                arrayNamesAndTypes = Map.toList $ getArrayNamesFromContract c
            let historyTableNames = map (historyTableName cr ap) hl
            $logInfoS "processTheMessages/arrayNamesAndTypes" $ T.pack $ show arrayNamesAndTypes
            $logDebugS "processTheMessages/historyTableNames" $ T.pack $ show historyTableNames

            let nameParts@(cr', ap',  n'') = (cr, ap, T.pack $ _contractName c)
            $logInfoS "processTheMessages/Contract Added" $ "ccreator=" <> cr' <> ", app=" <> ap' <> ", name=" <> n''
            multilineLog "processTheMessages/fields" $ boringBox $ map (show) $ Map.toList $ fmap _varType $ c ^. storageDefs

            --Create mapping tables
            deferredForeignKeysForMappings <- fmap concat $
              forM mappingNames $ \m -> do
                createMappingTable  nameParts m

            --Create array tables
            deferredForeignKeysForArrays <- fmap concat $
              forM arrayNamesAndTypes $ \anat -> do
                createArrayTable nameParts anat c cc
            
            deferredForeignKeys <- case (_contractType c) of
              AbstractType -> do
                abstractfkeys <- createExpandAbstractTable c nameParts abstracts' cc
                createExpandHistoryTable True c cc nameParts
                $logInfoS "processTheMessages/deferredForeignKeys/abstractfkeys" $ T.pack $ show abstractfkeys
                return abstractfkeys
              _ -> do
                indexfkeys <- createExpandIndexTable c cc nameParts
                $logInfoS "processTheMessages/deferredForeignKeys/indexfkeys" $ T.pack $ show indexfkeys
                createExpandHistoryTable False c cc nameParts
                return indexfkeys

            $logInfoS "processTheMessages/deferredForeignKeys" $ T.pack $ show deferredForeignKeys
            $logInfoS "processTheMessages/deferredForeignKeysForMappings" $ T.pack $ show deferredForeignKeysForMappings
            $logInfoS "processTheMessages/deferredForeignKeysForArrays" $ T.pack $ show deferredForeignKeysForArrays


            -- outputData conn $ createExpandEventTables g c cc nameParts
            deferredForeignKeysForEvents <- createExpandEventTables c cc nameParts


            return $ deferredForeignKeys ++ deferredForeignKeysForMappings ++ deferredForeignKeysForArrays ++ deferredForeignKeysForEvents

        -- forM_ deferredForeignKeys $ \deferredForeignKey -> do
        --   outputData conn $ createForeignIndexesForJoins deferredForeignKey
        pure $ Right deferredForeignKeys
  -- TODO: Add delegatecall indexing back in
  -- dfkeys' <- forM delegates $ \d@(Action.Delegatecall s c' o a) -> do
  --   dels <- getDelegates  s
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
  --           forM_ mapNames $ outputData conn . createCollectionTable  nameParts
  --           deferredForeignKeys <- outputData conn $ createExpandIndexTable c nameParts
  --           outputData' conn $ createExpandHistoryTable c nameParts
  --           outputData conn $ createExpandEventTables c nameParts
  --           pure deferredForeignKeys
        -- forM_ deferredForeignKeys $ outputData conn . createForeignIndexesForJoins
  --       addDelegate  s c'
  --       pure $ Right deferredForeignKeys

  let fkeys = rights $ fkeys' -- ++ dfkeys'
      concatFkeys = concat fkeys

  inserts <- fmap concat $ enterBloc2 env $ do
    forM changes $ \(_, actions) -> do
      results <- forM actions $ \(row) -> do
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
            $logInfoLS "Contract name is: " $ T.pack $ show name
            indexContract <- rowToInsert abiid row cont
            let fkeysForThisContract = getContractsFromPC indexContract
            let mapNames = actionMappings row --recorded mappings
                arrNames = actionArrays row --all
                collectionNames = mapNames ++ arrNames
                abstracts = actionAbstracts row
            --get columns for abstract table
            $logInfoLS "abstractColumns" $ T.pack $ "Getting abstract columns from " ++ (show abstracts)
            abstractColumns' <- fmap catMaybes . for (Map.toList abstracts) $ \((_, n'), (cr', ap', cols)) -> do
                let cregator = fromMaybe cr' (actionCCCreator row)
                    tableName = AbstractTableName cregator ap' n'
                    tableNameText = tableNameToDoubleQuoteText tableName
                $logDebugLS "actionCCCreator" $ T.pack (show (actionCCCreator row))
                $logDebugLS "cregator" $ T.pack (show cregator)
                $logInfoS "Row will be inserted into abstract table: " tableNameText
                $logInfoS "cols: " $ T.pack (show cols)
                
                let result = (indexContract, fkeysForThisContract, tableNameText, (cr', ap', n'), cols)
                $logInfoS "result: " $ T.pack (show result)
                pure (Just result)
            $logDebugLS "Globals: Recorded Map names are: " . T.pack $ show mapNames ++ " contract: " ++ show (E.contractName indexContract)
            $logDebugLS "Globals: Recorded Array names are: " . T.pack $ show arrNames ++ " contract: " ++ show (E.contractName indexContract)
            $logDebugLS "History inserts are: " $ T.pack $ show indexContract
            stateDiff <- rowToCollections row
            parents' <- pure $ map (\(_,_,_,p ,_)-> p) abstractColumns'
            abstractColumns <- pure $ map (\(a,b,c,_,e) -> (a,b,c,e)) abstractColumns'
            pCollections <- processedContractToProcessedCollectionRows stateDiff (collectionNames) row abiid (actionCCCreator row) --get all collection rows to insert
            pCollectionsWithAbstracts <- pure $ duplicateForParentsAndIncludeOriginal pCollections parents'
            recordAction row
            pure . Right $ BatchedInserts (indexContract, fkeysForThisContract) abstractColumns [indexContract] pCollectionsWithAbstracts
      
      pure results

  forM_ (lefts inserts) $ $logErrorS "processTheMessages"

  -- TODO: might need to group inserts by TableName
  let insertsByCodeHash = rights inserts

  forM_ (rights inserts) $ $logDebugLS "processTheMessages/toInsert"
  
  outputDataDedup conn $ do
    forM_ insertsByCodeHash $ \ins -> do
      insertIndexTable $ indexInsert ins
      insertAbstractTable (abstractInserts ins)-- not historic
      unless ((length (collectionInserts ins) < 1)) $ insertCollectionTable $ collectionInserts ins

      --updating the foreign keys from null
    forM_ insertsByCodeHash $ \ins -> do
      updateForeignKeysFromNULLAbstract (abstractInserts ins) -- not historic
      updateForeignKeysFromNULLIndex (indexInsert ins)
      unless ((length (collectionInserts ins) < 1)) $ updateForeignKeysFromNULLArray (collectionInserts ins)

    forM_ concatFkeys $ \deferredForeignKey -> do
      createForeignIndexesForJoins deferredForeignKey

  when (any (not . null) fkeys) $ do
    $logDebugLS "processTheMessages" $ T.pack $ "Updating PostgREST schema cache for " ++ show (sum $ map length fkeys) ++ " foreign key relationships"
    notifyPostgREST conn

  when (not (null events')) $ do
    --Getting event entries that go into the parent abstract tables and event array inserts
    let processedEvents = concatMap getAllEvents events'
        processedEventArrays = concatMap aggEventToCollectionRows processedEvents
         -- TODO: Remove arrays once marketplace switches over to using event array tables
        processedEventsWithoutArrays = processedEvents -- map (\ae -> ae { eventEvent = removeArrayEvArgs (eventEvent ae) }) processedEvents
        
    -- Insert the events into the event tables
    outputData conn $ insertEventTables processedEventArrays processedEventsWithoutArrays
    
    -- If there are processed event arrays, update the foreign keys
    unless (null processedEventArrays) $
      outputData conn $ updateForeignKeysFromNULLArray processedEventArrays

  $logInfoS "processTheMessages" . T.pack $ "Inserting " ++ show (length transactionResults) ++ " transaction results"

  forM_ transactionResults $ putTransactionResult

  return events'
