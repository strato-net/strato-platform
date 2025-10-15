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

module Blockchain.Slipstream.Processor
  ( processTheMessages,
    parseActions,
    )
where

import Bloc.Server.Utils
import BlockApps.Logging
import qualified BlockApps.SolidVMStorageDecoder as SolidVM
import qualified BlockApps.Solidity.Contract as OLD
import BlockApps.Solidity.Value
import qualified BlockApps.SolidityVarReader as SVR
import Blockchain.Data.AddressStateDB
import Blockchain.Data.TransactionResult
import Blockchain.Slipstream.Data.Action
import qualified Blockchain.Slipstream.Events as E
import Blockchain.Slipstream.OutputData
import Blockchain.Slipstream.Metrics (recordAction)
import Blockchain.Slipstream.QueryFormatHelper
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Event
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Stream.Action as Action
import qualified Blockchain.Stream.VMEvent as VME
import Conduit
import Control.Lens ((^.), (<&>))
import Control.Monad (forM, forM_, unless, when)
import Data.Either (lefts, rights)
import Data.Foldable (toList)
import Data.Function
import qualified Data.IntMap as I
import qualified Data.Map.Ordered as OMap
import Data.List (sortOn)
import qualified Data.Map as Map
import Data.Maybe
import Data.Ord (Down (..))
import Data.Source
import Data.Text (Text)
import qualified Data.Text as T
import Data.Traversable (for)
import SolidVM.Model.CodeCollection hiding (contractName)
import qualified SolidVM.Model.Type as SVMType
import Text.Format
import Text.Tools (boringBox, multilineLog)
import Prelude hiding (lookup)

diffNull :: Action.DataDiff -> Bool
diffNull (Action.EVMDiff m) = Map.null m
diffNull (Action.SolidVMDiff m) = Map.null m

data BatchedInserts = BatchedInserts
  { indexInsert :: E.ProcessedContract
  , collectionInserts :: [ProcessedCollectionRow]
  }
  deriving (Show)

matters :: AggregateAction -> Bool
matters AggregateAction {..} =
  (actionType == Action.Create || (not $ diffNull actionStorage))
    && (codePtrToSHA actionCodeHash /= emptyHash)


splitActions :: [AggregateAction] -> [(Address, [AggregateAction])]
splitActions = partitionWith actionAddress

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
    { address = actionAddress,
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
      transactionSender = actionTxSender
    }

rowToInsert ::
  ABIID ->
  AggregateAction ->
  OLD.Contract ->
  E.ProcessedContract
rowToInsert abiid row cont =
  let newState = case actionStorage row of
        Action.EVMDiff mp -> SVR.decodeCacheValues cont (flip Map.lookup mp) []
        Action.SolidVMDiff mp -> SolidVM.decodeCacheValues mp
   in processedContract abiid (Map.fromList $ newState) row


rowToCollections :: AggregateAction -> Map.Map Text Value
rowToCollections row =
  let newState = case actionStorage row of
        Action.SolidVMDiff mp -> SolidVM.decodeCacheValuesForCollections mp
        _ -> [] 
   in Map.fromList newState

processedContractToProcessedCollectionRows :: Map.Map Text Value -> AggregateAction -> ABIID -> Maybe Text -> [ProcessedCollectionRow]
processedContractToProcessedCollectionRows state row abiid cregator =
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
      processRecord (n, t, ks, v) = processedCollectionRow n t row abiid cregator ks v
   in processRecord <$> recordVMs  

processedCollectionRow :: Text -> Text -> AggregateAction -> ABIID -> Maybe Text -> [Value] -> Value ->  ProcessedCollectionRow
processedCollectionRow collection ttype AggregateAction {..} ABIID {..} cregator ks v =
  ProcessedCollectionRow
    { address = actionAddress,
      -- codehash = actionCodeHash,
      creator = actionCreator,
      cc_creator = cregator,
      root = actionRoot,
      contractname = aiName,
      eventInfo = Nothing,
      collection_name = collection,
      collection_type = ttype,
      blockHash = actionBlockHash,
      blockTimestamp = actionBlockTimestamp,
      blockNumber = actionBlockNumber,
      transactionHash = actionTxHash,
      transactionSender = actionTxSender,
      collectionDataKeys = ks,
      collectionDataValue = v 
    }

-- Prioritizing with-source actions prevents the issue where updates to contracts
-- at different addresses are lost because the schema has not been seen yet.
withSourceFirst :: (a, [AggregateAction]) -> Down Bool
withSourceFirst = Down . any (isJust . actionSrc) . snd

parseActions :: [VME.VMEvent] -> [(Address, [AggregateAction])]
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
          eventAbstracts = maybe Map.empty Action._actionDataAbstracts . OMap.lookup (evContractAddress e) $ Action._actionData a,
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

-- Function to duplicate each collection row for each parent, changing the contract name, and include the original
duplicateForParentsAndIncludeOriginal :: [ProcessedCollectionRow] -> [(Text,Text,Text)] -> [ProcessedCollectionRow]
duplicateForParentsAndIncludeOriginal collections parentz = concatMap duplicateForSingle collections
  where
    duplicateForSingle :: ProcessedCollectionRow -> [ProcessedCollectionRow]
    duplicateForSingle row = row : [ row { creator = c, contractname = n } | (c,_,n) <- parentz ]

processTheMessages ::
  ( MonadIO m
  , MonadLogger m
  ) =>
  [VME.VMEvent] ->
  ConduitM i (Either TransactionResult [SlipstreamQuery]) m [AggregateEvent]
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
        [(cc, cp, cr, ap) | VME.CodeCollectionAdded cc cp cr ap _ <- messages]
      delegatecalls = concatMap toList
        [Action._delegatecalls a | VME.NewAction a <- messages]
      transactionResults = [tr | VME.NewTransactionResult tr <- messages]

  fkeys <- mapOutput Right . outputDataDedup . fmap concat . forM creates $ \(cc, cp, cr, ap) -> do
    $logInfoS "processTheMessages" $ "CodeCollection Added: " <> T.pack (format cp) 
    multilineLog "processTheMessages/contracts" $ boringBox $ map show (Map.keys $ cc ^. contracts)

    fmap concat . forM (filter (_isContractRecord . snd) . Map.toList $ cc ^. contracts) $ \(_, c) -> do
      -- Here we will get the storageDefs attribute of the contract (c)
      -- and iterate through the Map of (Text, VariableDecl) and look for
      -- VariableDecls that have the last attribute (isRecord) true and
      -- thetype are mappings We will then create a table for each of
      -- these collections and add a foreign key to the main table

      let collectionNamesAndTypes = getCollectionsFromContract c
      $logInfoS "processTheMessages/collectionNamesAndTypes" $ T.pack $ show collectionNamesAndTypes

      let nameParts@(cr', ap',  n'') = (cr, ap, T.pack $ _contractName c)
      $logInfoS "processTheMessages/Contract Added" $ "ccreator=" <> cr' <> ", app=" <> ap' <> ", name=" <> n''
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
          Action.EVMDiff {} -> pure $ Left "EVM code indexing ignored"
          Action.SolidVMDiff {} -> do
            let name = case actionCodeHash row of
                  SolidVMCode name' _ -> name'
                  _ -> error "internal error: contract should be SolidVM for SolidVM"
                abiid =
                  ABIID
                    { aiName = T.pack name,
                      aiChain = ""
                    }
                cont = error "internal error: contract should be unused for SolidVM"
            $logInfoLS "Contract name is: " $ T.pack $ show name
            let indexContract = rowToInsert abiid row cont
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
                
                let result = (indexContract, tableName, (cr', ap', n'), cols)
                $logInfoS "result: " $ T.pack (show result)
                pure (Just result)
            $logDebugLS "History inserts are: " $ T.pack $ show indexContract
            let stateDiff = rowToCollections row
                parents' = map (\(_,_,p ,_)-> p) abstractColumns'
                pCollections = processedContractToProcessedCollectionRows stateDiff row abiid (actionCCCreator row) --get all collection rows to insert
                pCollectionsWithAbstracts = duplicateForParentsAndIncludeOriginal pCollections parents'
            recordAction row
            pure . Right $ BatchedInserts indexContract pCollectionsWithAbstracts

  forM_ (lefts inserts) $ $logErrorS "processTheMessages"

  -- TODO: might need to group inserts by TableName
  let insertsByCodeHash = rights inserts

  forM_ (rights inserts) $ $logDebugLS "processTheMessages/toInsert"
  
  mapOutput Right . outputDataDedup $ do
    forM_ insertsByCodeHash $ \ins -> do
      insertIndexTable $ indexInsert ins
      unless (null $ collectionInserts ins) $
        insertCollectionTable $ collectionInserts ins

    forM_ delegatecalls insertDelegatecall

  let processedEvents = concatMap getAllEvents events'
      processedEventArrays = concatMap aggEventToCollectionRows processedEvents

  when (not (null events')) $ do
    mapOutput Right . outputData $ pipeInsertGlobalEventTable processedEvents
    unless (null processedEventArrays) $
      mapOutput Right . outputData $ insertCollectionTable processedEventArrays

  let delegateMap = Map.fromList $ (\d -> (Action._delegatecallStorageAddress d, d)) <$> delegatecalls
      insertViews = insertsByCodeHash >>= \ins ->
        let indexView = (\i ->
              indexTableName
                (E.creator i)
                (E.application i)
                (E.contractName i)
              ) $ indexInsert ins
            collViews = (\c ->
              collectionTableName
                (creator c)
                ""
                (contractname c)
                (collection_name c)
              : maybe [] (\Action.Delegatecall{..} -> [
                  collectionTableName
                    _delegatecallOrganization
                    _delegatecallApplication
                    _delegatecallContractName
                    (collection_name c)
                ]) (Map.lookup (address c) delegateMap)
              ) =<< collectionInserts ins
         in indexView : collViews
      eventViews = (\e ->
        eventTableName
          (T.pack $ evContractCreator e)
          (T.pack $ evContractApplication e)
          (T.pack $ evContractName e)
          (T.pack $ evName e)
        : maybe [] (\Action.Delegatecall{..} -> [
          eventTableName
            _delegatecallOrganization
            _delegatecallApplication
            _delegatecallContractName
            (T.pack $ evName e)
        ]) (Map.lookup (evContractAddress e) delegateMap)
        ) =<< eventEvent <$> processedEvents
      eventArrViews = concat $ mapMaybe (\e -> eventInfo e <&> \(eName, _) ->
        eventCollectionTableName
          (creator e)
          ""
          (contractname e)
          eName
          (collection_name e)
        : maybe [] (\Action.Delegatecall{..} -> [
          eventCollectionTableName
            _delegatecallOrganization
            _delegatecallApplication
            _delegatecallContractName
            eName
            (collection_name e)
        ]) (Map.lookup (address e) delegateMap)
        ) processedEventArrays
      delegateViews = (\Action.Delegatecall{..} ->
        indexTableName
          _delegatecallOrganization
          _delegatecallApplication
          _delegatecallContractName
        ) <$> delegatecalls
      allViews = insertViews ++ eventViews ++ eventArrViews ++ delegateViews

  _ <- mapOutput Right . outputDataDedup $ traverse refreshMaterializedView allViews

  when (not $ null fkeys) $ do
    $logDebugLS "processTheMessages" $ T.pack $ "Updating PostgREST schema cache for " ++ show (length fkeys) ++ " foreign keys"
    mapOutput Right . outputDataDedup $ createFkeyFunctions fkeys
    mapOutput Right . outputData $ notifyPostgREST

  $logInfoS "processTheMessages" . T.pack $
    "Inserting " ++ show (length transactionResults) ++ " transaction results"

  yieldMany $ Left <$> transactionResults

  return events'

