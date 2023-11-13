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

import Bloc.Database.Queries
import Bloc.Monad
import Bloc.Server.Utils
import BlockApps.Logging
import qualified BlockApps.SolidVMStorageDecoder as SolidVM
import qualified BlockApps.Solidity.Contract as OLD
import BlockApps.Solidity.Value
import qualified BlockApps.SolidityVarReader as SVR
import Blockchain.DB.CodeDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.AddressStateRef
import Blockchain.Data.ChainInfo
import Blockchain.Data.DataDefs
import Blockchain.Data.Json
import Blockchain.Data.TransactionResult
import Blockchain.SolidVM.CodeCollectionDB
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Stream.Action as Action
import Blockchain.Stream.VMEvent
import Control.Arrow ((&&&))
import Control.Lens (at, (.~), (?~), (^.))
import Control.Monad.Change.Alter
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Composable.SQL
import Control.Monad.Except
import Control.Monad.IO.Unlift
import Control.Monad.Trans.Maybe
import Control.Monad.Trans.Reader
import Control.Monad.Trans.State.Strict hiding (state)
import qualified Data.Aeson as Aeson
import Data.Either (lefts, rights)
import Data.Foldable (fold, for_, toList)
import Data.Function
import Data.IORef
import Data.List (foldl', sortOn)
import qualified Data.Map as Map
import Data.Maybe
import Data.Ord (Down (..))
import qualified Data.Set as S
import Data.Source.Map
import Data.Text (Text)
import qualified Data.Text as T
import Data.Text.Encoding
import Data.Traversable (for)
import Database.PostgreSQL.Typed (PGConnection)
import qualified Handlers.AccountInfo as Account
import SelectAccessible ()
import Slipstream.Data.Action
import Slipstream.Events
import qualified Slipstream.Events as SE
import Slipstream.Globals
import Slipstream.Metrics
import Slipstream.OutputData
import Slipstream.QueryFormatHelper
import SolidVM.CodeCollectionTools
import SolidVM.Model.CodeCollection hiding (contractName)
import qualified SolidVM.Model.CodeCollection as CC (contractName)
import SolidVM.Model.SolidString
import qualified SolidVM.Model.Type as SVMType
import Text.Format
import Prelude hiding (lookup)

instance MonadUnliftIO m => Selectable Account Contract (SQLM m) where
  select _ a = runMaybeT $ do
    (AddressStateRef' r _) <-
      MaybeT
        . fmap listToMaybe
        . Account.getAccount'
        $ Account.accountsFilterParams
          & Account.qaAddress ?~ (a ^. accountAddress)
          & Account.qaChainId .~ (fmap ChainId . maybeToList $ a ^. accountChainId)
    codePtr <- MaybeT . pure $ addressStateRefCodePtr r
    MaybeT $ either (const Nothing) (Just . snd) <$> getContractDetailsByCodeHash codePtr

instance (MonadUnliftIO m, Mod.Accessible (IORef Globals) m) => Selectable Account CodeCollection (SQLM m) where
  select _ acct = do
    g <- lift $ Mod.access (Mod.Proxy @(IORef Globals))
    let getCCForAccount a = do
          mASR <-
            fmap listToMaybe
              . Account.getAccount'
              $ Account.accountsFilterParams
                & Account.qaAddress ?~ (a ^. accountAddress)
                & Account.qaChainId .~ (fmap ChainId . maybeToList $ a ^. accountChainId)
          let codePtr =
                fromMaybe (EVMCode emptyHash) $
                  (\(AddressStateRef' r _) -> addressStateRefCodePtr r) =<< mASR
              getContract n cc = (,cc) <$> Map.lookup n (cc ^. contracts)
          unsafeResolveCodePtr codePtr >>= \case
            Just (SolidVMCode n ch) ->
              getCCFromGlobals g ch >>= \case
                Just cc -> pure $ getContract n cc
                Nothing -> do
                  mCC <- either (const Nothing) Just <$> getCodeCollectionByCodePtr codePtr
                  for_ mCC $ putCCIntoGlobals g ch
                  pure $ mCC >>= getContract n
            _ -> pure Nothing
    getCCForAccount acct >>= \case
      mCC@(Just _) -> do
        ds <- getDelegates g acct
        (c, cc) <- fold . catMaybes . (mCC :) <$> traverse getCCForAccount ds
        pure . Just $ (contracts . at (c ^. CC.contractName) ?~ c) cc
      _ -> pure Nothing

instance Monad m => Selectable Word256 ParentChainIds (SQLM m) where
  select _ _ = pure Nothing

instance Selectable Account Contract m => Selectable Account Contract (ReaderT BlocEnv m) where
  select p = lift . select p

instance MonadUnliftIO m => (Keccak256 `Selectable` SourceMap) (SQLM m) where
  select _ = Account.getCodeFromPostgres

instance MonadUnliftIO m => (Keccak256 `Alters` DBCode) (SQLM m) where
  lookup _ k = fmap (SolidVM,) <$> Account.getCodeByteStringFromPostgres k
  insert _ _ _ = error "Slipstream: Keccak256 `Alters` DBCode insert"
  delete _ _ = error "Slipstream: Keccak256 `Alters` DBCode delete"

instance (Keccak256 `Selectable` SourceMap) m => (Keccak256 `Selectable` SourceMap) (ReaderT BlocEnv m) where
  select p = lift . select p

instance MonadUnliftIO m => Selectable Account AddressState (SQLM m) where
  select _ a = runMaybeT $ do
    (AddressStateRef' r _) <-
      MaybeT
        . fmap listToMaybe
        . Account.getAccount'
        $ Account.accountsFilterParams
          & Account.qaAddress ?~ (a ^. accountAddress)
          & Account.qaChainId .~ (fmap ChainId . maybeToList $ a ^. accountChainId)
    codePtr <- MaybeT . pure $ addressStateRefCodePtr r
    pure $
      AddressState
        (addressStateRefNonce r)
        (addressStateRefBalance r)
        (addressStateRefContractRoot r)
        codePtr
        (toMaybe 0 $ addressStateRefChainId r)

instance Selectable Account AddressState m => Selectable Account AddressState (ReaderT BlocEnv m) where
  select p = lift . select p

diffNull :: Action.DataDiff -> Bool
diffNull (Action.EVMDiff m) = Map.null m
diffNull (Action.SolidVMDiff m) = Map.null m

mergeDiffs :: Action.DataDiff -> Action.DataDiff -> Action.DataDiff
mergeDiffs (Action.EVMDiff lhs) (Action.EVMDiff rhs) = Action.EVMDiff $ lhs <> rhs
mergeDiffs (Action.SolidVMDiff lhs) (Action.SolidVMDiff rhs) = Action.SolidVMDiff $ lhs <> rhs
mergeDiffs lhs rhs = error $ "Invalid diff combination: " ++ show (lhs, rhs)

data BatchedInserts = BatchedInserts
  { indexInsert :: ProcessedContract,
    abstractInsert :: [(ProcessedContract, T.Text, TableColumns)],
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
      organization = actionOrganization,
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
      organization = actionOrganization,
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
          eventEvent = e
        }

getCodeCollection ::
  ( MonadIO m,
    HasCodeDB m,
    Selectable Account AddressState m
  ) =>
  IORef Globals ->
  CodePtr ->
  Text ->
  m (Either String CodeCollection)
getCodeCollection g cp ccString = do
  let initList =
        case Aeson.decodeStrict $ encodeUtf8 ccString of
          Just l -> l
          Nothing -> case Aeson.decodeStrict $ encodeUtf8 ccString of
            Just m -> Map.toList m
            Nothing -> [(T.empty, ccString)] -- for backwards compatibility
            --We shouldn't crash if the source can't be parsed (a bad validator could brind the network down)
            --For now I'm going to keep the crash in, since it will be a warning to us that we let a
            --bad contract into the blockchain (the API shouldn't allow this)
  case cp of
    SolidVMCode _ ch ->
      getCCFromGlobals g ch >>= \case
        Just cc -> pure $ Right cc
        Nothing ->
          (fmap resolveLabels <$> compileSource False (Map.fromList initList)) >>= \case
            Left e -> return $ Left $ "failed parse: " ++ show e --- return $ CodeCollection Map.empty
            Right v -> do
              putCCIntoGlobals g ch v
              return $ Right v
    EVMCode _ -> return $ Left "EVM contracts are not indexed by Slipstream"
    CodeAtAccount _ _ -> return $ Left "Cannot compile or parse code at account"

getContractsForParents :: [SolidString] -> Map.Map SolidString (ContractF a) -> [ContractF a]
getContractsForParents parents' cc =
  let getContractForParent parent = Map.lookup parent cc
   in mapMaybe getContractForParent parents'

getMapNamesFromContract :: Contract -> [Text]
getMapNamesFromContract c =
  let storageDefs' = c ^. storageDefs
      storageDefsList = Map.toList storageDefs'
      listOfMappings = filter (\(_, vd) -> case (_varType vd) of SVMType.Mapping _ _ _ -> True; _ -> False) storageDefsList
      listOfMappingsWithRecords = filter (\(_, vd) -> _isRecord vd) listOfMappings
   in T.pack . fst <$> listOfMappingsWithRecords

getAbstractParentsFromContract :: Contract -> CodeCollection -> [Contract]
getAbstractParentsFromContract c cc =
  -- recursively obtain parent + grandparent contracts
  -- ex. B is A, C is B, then C should also be A
  let go [] = []
      go xs = xs ++ (go $ getContractsForParents (concatMap (^. parents) xs) ccc)
      ccc = cc ^. contracts
      parents' = c ^. parents
   in filter ((== AbstractType) . _contractType) (go $ getContractsForParents parents' ccc)

processTheMessages ::
  ( MonadLogger m,
    HasSQL m,
    Selectable Account AddressState m,
    Selectable Account CodeCollection m,
    Selectable Account Contract m,
    Selectable Word256 ParentChainIds m,
    HasCodeDB m,
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
      creates = [(c, cp, o, a, hl, rm) | CodeCollectionAdded c cp o a hl rm <- messages]
      delegates = [d | DelegatecallMade d <- messages]
      transactionResults = [tr | NewTransactionResult tr <- messages]
      -- Use different functions based on flag value, this way it is only computed once, saving cpu cycles with if statements
      getCC = getCodeCollection

  fkeys' <- forM creates $ \(ccString, cp, o, a, hl, _) -> do
    cc' <- getCC g cp ccString
    case cc' of
      Right cc -> do
        $logInfoS "processTheMessages" $ "CodeCollection Added: " <> T.pack (format cp) <> ", contracts = " <> T.pack (show $ Map.keys $ cc ^. contracts)

        deferredForeignKeys <- fmap concat $
          forM (Map.toList $ cc ^. contracts) $ \(nameString, c) -> do
            let a' =
                  if a /= ""
                    then a
                    else case cp of
                      SolidVMCode n' _ | nameString /= n' -> T.pack n'
                      _ -> a

            -- Here we will get the storageDefs attribute of the contract (c) and iterate through the Map of (Text, VariableDecl) and look for VariableDecls that have the last attribute (isRecord) true and thetype are mappings
            -- We will then create a table for each of these mappings and add a foreign key to the main table

            let mapNames = getMapNamesFromContract c

            let historyTableNames = map (historyTableName o a') hl
            $logInfoS "processTheMessages/historyTableNames" $ T.pack $ show historyTableNames

            nameParts@(o'', a'', n'') <- resolveNameParts o a' c
            $logInfoS "processTheMessages" $ "New Contract Added: org=" <> o'' <> ", app=" <> a'' <> ", name=" <> n'' <> " (fields: " <> T.pack (show $ Map.toList $ fmap _varType $ c ^. storageDefs) <> ")"

            --Create mapping tables
            deferredForeignKeysForMappings <- fmap concat $
              forM mapNames $ \m -> do
                outputData conn $ createMappingTable g nameParts m --Tables are created

            -- mark

            deferredForeignKeys <- case (_contractType c) of
              AbstractType -> do
                _ <- outputData conn $ createExpandAbstractTable g c nameParts cc
                return []
              _ -> do
                outputData conn $ createExpandIndexTable g c nameParts

            outputData' conn $ createExpandHistoryTable g c nameParts

            outputData conn $ createExpandEventTables g c nameParts

            return $ deferredForeignKeys ++ deferredForeignKeysForMappings

        forM_ deferredForeignKeys $ \deferredForeignKey -> do
          outputData conn $ createForeignIndexesForJoins deferredForeignKey
        pure $ Right deferredForeignKeys
      Left cc -> do
        $logInfoS "processTheMessages" $ T.pack cc
        pure $ Left cc -- Either String String
  dfkeys' <- forM delegates $ \d@(Action.Delegatecall s c' o a) -> do
    dels <- getDelegates g s
    $logInfoS "processTheMessages" $ "Got delegates for " <> T.pack (format s) <> ": " <> T.pack (show dels)
    if c' `elem` dels
      then do
        $logInfoS "processTheMessages" $ T.pack (format c') <> " was already seen as a delegate of " <> T.pack (format s)
        pure $ Right []
      else do
        $logInfoS "processTheMessages" $ T.pack (format c') <> " was not a delegate of " <> T.pack (format s)
        $logInfoS "processTheMessages" $ "Delegatecall made: " <> T.pack (format d)
        mStorageContract <- select (Proxy @Contract) s
        mCodeContract <- select (Proxy @Contract) c'
        mCodeCollection <- select (Proxy @CodeCollection) c' 
        deferredForeignKeys <- case (,,) <$> mStorageContract <*> mCodeContract <*> mCodeCollection of
          Nothing -> pure []
          Just (sc, cc, _') -> do
            let c = cc {_contractName = _contractName sc}
                mapNames = getMapNamesFromContract c
            nameParts <- resolveNameParts o a c
            forM_ mapNames $ outputData conn . createMappingTable g nameParts
            deferredForeignKeys <- outputData conn $ createExpandIndexTable g c nameParts
            outputData' conn $ createExpandHistoryTable g c nameParts
            outputData conn $ createExpandEventTables g c nameParts
            pure deferredForeignKeys
        forM_ deferredForeignKeys $ outputData conn . createForeignIndexesForJoins
        addDelegate g s c'
        pure $ Right deferredForeignKeys

  let fkeys = rights $ fkeys' ++ dfkeys'

  inserts <- enterBloc2 env $ do
    forM changes $ \(acct, actions) -> do
      let row = combineActions actions
      mapM_ recordAction actions
      recordCombinedAction row
      $logInfoS "processTheMessages" $ "Combined Action = " <> formatAction row
      $logDebugS "processTheMessages" $ T.pack $ "the diff is " ++ format (actionStorage row)

      case actionStorage row of
        Action.EVMDiff {} -> pure $ Left "EVM code indexing ignored"
        Action.SolidVMDiff {} -> do
          let cid = maybe "" (T.pack . chainIdString . ChainId) $ (actionAccount row ^. accountChainId)
              -- (SolidVMCode name _) = actionCodeHash row
              name = case actionCodeHash row of
                SolidVMCode name' _ -> name'
                _ -> error "internal error: contract should be SolidVM for SolidVM"
              abiid =
                ABIID
                  { aiName = T.pack name,
                    aiChain = cid
                  }
              cont = error "internal error: contract should be unused for SolidVM"
          $logDebugLS "Contract name is: " $ show name
          oldState <- readPreviousSolidVMState g acct
          indexContract <- rowToInsert g abiid row cont oldState
          hs <- rowToHistories g abiid actions cont oldState
          let cName = T.unpack $ SE.contractName indexContract
          mCC <- lift $ select (Proxy @CodeCollection) (actionAccount row)
          case (,) <$> mCC <*> (Map.lookup cName . _contracts =<< mCC) of
            Nothing -> do
              $logInfoS "processTheMessages" . T.pack $ "ERROR: Contract not in Code Collection "
              pure . Right $ BatchedInserts indexContract [] hs []
            Just (cc, c) -> do
              let mapNames = getMapNamesFromContract c
                  abstracts = getAbstractParentsFromContract c cc
                  appName =
                    if T.null $ SE.application indexContract
                      then SE.contractName indexContract
                      else SE.application indexContract
              --get columns for abstract table
              $logDebugLS "abstractColumns" $ T.pack $ "Getting abstract columns from " ++ (show abstracts)
              abstractColumns <- fmap catMaybes . for abstracts $ \ab -> do
                (o', a', n') <- lift $ resolveNameParts (SE.organization indexContract) appName ab
                let tableName = AbstractTableName o' a' n'
                    tableNameText = tableNameToDoubleQuoteText tableName
                $logInfoS "Row will be inserted into abstract table: " tableNameText
                mCols <- getTableColumns g tableName
                pure $ (indexContract,tableNameText,) . map extractTextInsideQuotes <$> mCols
              $logDebugLS "Globals: Recorded Map names are: " . T.pack $ show mapNames ++ " contract: " ++ show (contractName indexContract)
              $logDebugLS "History inserts are: " $ show hs
              stateDiff <- rowToMappings row
              pMappings <- processedContractToProcessedMappingRows stateDiff (mapNames) row abiid --get all mapping rows to insert
              pure . Right $ BatchedInserts indexContract abstractColumns hs pMappings

  forM_ (lefts inserts) $ $logErrorS "processTheMessages"

  -- TODO: might need to group inserts by TableName
  let insertsByCodeHash =
        map snd
          -- SolidVM contracts can have the same codehash and be different:
          -- the codehash is just a sourcehash.
          . partitionWith (SE.codehash . indexInsert &&& SE.contractName . indexInsert)
          $ rights inserts
  forM_ (rights inserts) $ $logDebugLS "processTheMessages/toInsert"
  forM_ insertsByCodeHash $ \ins -> do
    unless (null ins) $ outputData conn . insertIndexTable $ map indexInsert ins
    outputData conn . insertHistoryTable $ concatMap historyInserts ins
    unless ((length (concatMap mappingInserts ins) < 1)) $ outputData conn . insertMappingTable $ concatMap mappingInserts ins
    unless (null ins) $ outputData conn . insertAbstractTable $ concatMap abstractInsert ins

  forM_ insertsByCodeHash $ \ins -> do
    unless (null ins) $ insertForeignKeys conn $ map indexInsert ins

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
