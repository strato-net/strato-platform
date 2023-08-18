{-# LANGUAGE
    BangPatterns
    , DataKinds
    , DeriveGeneric
    , FlexibleContexts
    , FlexibleInstances
    , LambdaCase
    , GeneralizedNewtypeDeriving
    , MultiParamTypeClasses
    , OverloadedStrings
    , QuasiQuotes
    , RecordWildCards
    , ScopedTypeVariables
    , TemplateHaskell
    , TupleSections
    , TypeApplications
    , TypeOperators
#-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Slipstream.Processor
  ( processTheMessages
  , parseActions
  , generateAssetTable
  , generateSaleTable
  , generateUserTable
  ) where

import Prelude hiding (lookup)
import qualified Data.Aeson                           as Aeson
import Control.Arrow ((&&&))
import Control.Lens ((^.), (.~), (?~))
import Control.Monad.Change.Alter
import Control.Monad.Except
import Control.Monad.IO.Unlift
import Control.Monad.Trans.Maybe
import Control.Monad.Trans.Reader
import Control.Monad.Trans.State.Strict hiding (state)
import Data.Either (lefts, rights)
import Data.Foldable (toList)
import Data.Function
import Data.IORef
import qualified Data.Set as S
import Data.List (foldl', sortOn)
import qualified Data.Map as Map
import Data.Maybe
import Data.Ord (Down(..))
import qualified Data.Text as T
import Data.Text (Text)
import Data.Text.Encoding
import Database.PostgreSQL.Typed (PGConnection)

import Bloc.Database.Queries
import Bloc.Monad
import Bloc.Server.Utils
import BlockApps.Logging
import qualified BlockApps.Solidity.Contract as OLD
import BlockApps.Solidity.Value
import qualified BlockApps.SolidityVarReader as SVR
import qualified BlockApps.SolidVMStorageDecoder as SolidVM

import Blockchain.Data.AddressStateRef
import Blockchain.Data.AddressStateDB
import Blockchain.Data.TransactionResult
import Blockchain.Data.DataDefs
import Blockchain.Data.Json
import Blockchain.DB.CodeDB
import Blockchain.SolidVM.CodeCollectionDB
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.Keccak256
import qualified Blockchain.Stream.Action as Action
import Blockchain.Stream.VMEvent

import Control.Monad.Composable.SQL
import qualified Handlers.AccountInfo            as Account

import Data.Source.Map

import SelectAccessible                         ()

import Slipstream.Data.Action
import Slipstream.Events
import qualified Slipstream.Events as SE
import Slipstream.Globals
import Slipstream.Metrics
import Slipstream.OutputData

import SolidVM.CodeCollectionTools
import SolidVM.Model.CodeCollection hiding (contractName)
import SolidVM.Model.SolidString
import qualified SolidVM.Model.Type as SVMType

import Text.Format

instance MonadUnliftIO m => Selectable Account Contract (SQLM m) where
  select _ a = runMaybeT $ do
    (AddressStateRef' r _) <- MaybeT
                            . fmap listToMaybe
                            . Account.getAccount'
                            $ Account.accountsFilterParams
                            & Account.qaAddress ?~ (a ^. accountAddress)
                            & Account.qaChainId .~ (fmap ChainId . maybeToList $ a ^. accountChainId)
    codePtr <- MaybeT . pure $ addressStateRefCodePtr r
    MaybeT $ either (const Nothing) (Just . snd) <$> getContractDetailsByCodeHash codePtr

instance Selectable Account Contract m => Selectable Account Contract (ReaderT BlocEnv m) where
  select p = lift . select p

instance MonadUnliftIO m => (Keccak256 `Selectable` SourceMap) (SQLM m) where
  select _ = Account.getCodeFromPostgres

instance MonadUnliftIO m => (Keccak256 `Alters` DBCode) (SQLM m) where
  lookup _ k   = fmap (SolidVM,) <$> Account.getCodeByteStringFromPostgres k
  insert _ _ _ = error "Slipstream: Keccak256 `Alters` DBCode insert"
  delete _ _   = error "Slipstream: Keccak256 `Alters` DBCode delete"

instance (Keccak256 `Selectable` SourceMap) m => (Keccak256 `Selectable` SourceMap) (ReaderT BlocEnv m) where
  select p = lift . select p

instance MonadUnliftIO m => Selectable Account AddressState (SQLM m) where
  select _ a = runMaybeT $ do
    (AddressStateRef' r _) <- MaybeT
                            . fmap listToMaybe
                            . Account.getAccount'
                            $ Account.accountsFilterParams
                            & Account.qaAddress ?~ (a ^. accountAddress)
                            & Account.qaChainId .~ (fmap ChainId . maybeToList $ a ^. accountChainId)
    codePtr <- MaybeT . pure $ addressStateRefCodePtr r
    pure $ AddressState
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
  { indexInsert     :: ProcessedContract
  , abstractInsert     :: Maybe (ProcessedContract, T.Text, TableColumns)
  , historyInserts  :: [ProcessedContract]
  , mappingInserts  :: [ProcessedMappingRow]
  } deriving (Show)

enterBloc2 :: r -> ReaderT r m a -> m a
enterBloc2 = flip runReaderT

matters :: AggregateAction -> Bool
matters AggregateAction{..} = (actionType == Action.Create || (not $ diffNull actionStorage))
                           && (resolvedCodePtrToSHA actionCodeHash /= emptyHash)

-- assumes all Actions in the list are for the same Account
combineActions :: [AggregateAction] -> AggregateAction
combineActions [] = error "cannot combine 0 actions"
combineActions (x:xs) = foldl' merge x xs
  where
    merge a b = b { actionStorage  = (mergeDiffs `on` actionStorage) b a
                  , actionMetadata = (Map.union `on` actionMetadata) b a
                  }

splitActions :: [AggregateAction] -> [(Account, [AggregateAction])]
splitActions = partitionWith actionAccount

data ABIID = ABIID { aiName :: Text
                   , aiChain :: Text
                   } deriving (Eq, Show)

processedContract :: ABIID
                  -> Map.Map Text Value
                  -> AggregateAction
                  -> ProcessedContract
processedContract ABIID{..} state AggregateAction{..} =
  ProcessedContract
    { address = actionAccount ^. accountAddress
    , codehash = actionCodeHash
    , organization = actionOrganization
    , application  = actionApplication
    , contractName = aiName
    , chain = aiChain
    , contractData = state
    , blockHash = actionBlockHash
    , blockTimestamp = actionBlockTimestamp
    , blockNumber = actionBlockNumber
    , transactionHash = actionTxHash
    , transactionSender = actionTxSender ^. accountAddress
    }

readPreviousSolidVMState :: MonadIO m =>
                            IORef Globals -> Account -> m [(Text, Value)]
readPreviousSolidVMState gref acct = fromMaybe [] <$> getContractState gref acct

rowToInsert :: MonadIO m =>
               IORef Globals -> ABIID -> AggregateAction -> OLD.Contract -> [(Text, Value)]
            -> m ProcessedContract
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


processedContractToProcessedMappingRows :: MonadIO m => Map.Map Text Value -> [Text]-> AggregateAction -> ABIID ->m [ProcessedMappingRow]
processedContractToProcessedMappingRows state mapNames row abiid = do
  let valueMappingsMap =  Map.filter (\value -> case value of ValueMapping _ -> True; _ -> False) (state)
      onlyRecord = Map.toList (Map.restrictKeys valueMappingsMap (S.fromList mapNames)) 
      recordVMs = fmap (\(a, value) -> case value of ValueMapping b -> (a, b); _ -> undefined) onlyRecord
  if null valueMappingsMap then return $ []
  else do
    let result = concatMap (\(mName, theMap) -> map (\(k,v) -> processedMappingRow mName row abiid (SimpleValue k) v ) (Map.toList theMap)) (recordVMs)
    return $ result
      
rowToHistories :: (MonadIO m) =>
                  IORef Globals -> ABIID -> [AggregateAction] -> OLD.Contract
               -> [(Text, Value)]
               -> m [ProcessedContract]
rowToHistories _ abiId actions cont oldState = do
  flip evalStateT oldState . forM actions $ \hRow -> do
    modify $ case actionStorage hRow of
                Action.EVMDiff mp -> SVR.decodeCacheValues cont (flip Map.lookup mp)
                Action.SolidVMDiff mp -> SolidVM.decodeCacheValues mp
    newMap <- gets Map.fromList
    return $ processedContract abiId newMap hRow

processedMappingRow ::  Text -> AggregateAction -> ABIID -> Value -> Value-> ProcessedMappingRow
processedMappingRow mapping AggregateAction{..} ABIID{..} k v =
   ProcessedMappingRow {
    address           =  actionAccount ^. accountAddress 
  , codehash          =  actionCodeHash 
  , organization      =  actionOrganization 
  , application       =  actionApplication 
  , contractname      =  aiName 
  , mapname           =  mapping
  , chain             =  aiChain 
  , blockHash         =  actionBlockHash 
  , blockTimestamp    =  actionBlockTimestamp 
  , blockNumber       =  actionBlockNumber 
  , transactionHash   =  actionTxHash 
  , transactionSender =  actionTxSender ^. accountAddress 
  , mapDataKey        =  k
  , mapDataValue      =  v
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
  . concatMap (flatten) $ [a | NewAction a <- events']

parseEvents :: [VMEvent] -> [AggregateEvent]
parseEvents = concatMap parseEvent
  where parseEvent (NewAction a) = mkAggregateEvent a <$> toList (Action._events a)
        parseEvent _ = []
        mkAggregateEvent a e = AggregateEvent
          { eventBlockHash      = Action._blockHash a
          , eventBlockTimestamp = Action._blockTimestamp a
          , eventBlockNumber    = Action._blockNumber a
          , eventTxHash         = Action._transactionHash a
          , eventTxSender       = Action._transactionSender a
          , eventEvent          = e
          }

getCodeCollection :: ( MonadIO m
                     , HasCodeDB m
                     , Selectable Account AddressState m
                     )
                  => CodePtr -> Text -> m (Either String CodeCollection)
getCodeCollection cp ccString = do
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
    SolidVMCode _ _ -> (fmap resolveLabels <$> compileSource False (Map.fromList initList)) >>= \case
        Left e -> return $ Left $ "failed parse: "  ++ show e --- return $ CodeCollection Map.empty
        Right v -> return $ Right v
    EVMCode _ -> return $ Left "EVM contracts are not indexed by Slipstream"
    CodeAtAccount _ _ -> return $ Left "Cannot compile or parse code at account"

getContractsForParents :: [SolidString] -> Map.Map SolidString (ContractF a) -> [ContractF a]
getContractsForParents parents' cc =
  let getContractForParent parent = Map.lookup parent cc
  in mapMaybe getContractForParent parents'

processTheMessages :: ( MonadLogger m
                      , HasSQL m
                      , Selectable Account AddressState m
                      , HasCodeDB m
                      )
                   => BlocEnv -> PGConnection -> IORef Globals -> [VMEvent] -> m ()
processTheMessages env conn g messages = do

  case length messages of
   0 -> return ()
   1 -> $logInfoS "processTheMessages" "1 message has arrived"
   n -> $logInfoS "processTheMessages" . T.pack $ show n ++ " messages have arrived"

  let changes = parseActions messages
      events' = parseEvents messages
      -- TODO (Dan) : would be nice if we didn't just rip events out at the top level like this
      creates = [(c, cp, o, a, hl, rm) | CodeCollectionAdded c cp o a hl rm <- messages]
      transactionResults = [tr | NewTransactionResult tr <- messages]
      -- Use different functions based on flag value, this way it is only computed once, saving cpu cycles with if statements
      getCC = getCodeCollection
    
  -- forM :: [a] -> (a -> m b) -> m [b]
  -- forM :: [a] -> (a -> m (Either b c)) -> m [Either b c]
  -- m [c]

  fkeys' <- forM creates $ \(ccString, cp, o, a, hl, _) -> do
    cc' <- getCC cp ccString
    case cc' of
      Right cc -> do
              $logInfoS "processTheMessages" $ "CodeCollection Added: " <> T.pack (format cp) <> ", contracts = " <> T.pack (show $ Map.keys $ cc^.contracts)


              deferredForeignKeys <- fmap concat $ forM (Map.toList $ cc^.contracts) $ \(nameString, c) -> do
                let n = labelToText nameString
                    a' = if a /= ""
                           then a
                           else case cp of
                            SolidVMCode n' _ | nameString /= n' -> T.pack n'
                            _ -> a


                -- Here we will get the storageDefs attribute of the contract (c) and iterate through the Map of (Text, VariableDecl) and look for VariableDecls that have the last attribute (isRecord) true and thetype are mappings
                -- We will then create a table for each of these mappings and add a foreign key to the main table

                let storageDefs' = c ^. storageDefs
                    storageDefsList = Map.toList storageDefs'
                    listOfMappings = filter (\(_, vd) -> case (_varType vd) of SVMType.Mapping _ _ _ -> True ; _ -> False;) storageDefsList
                    listOfMappingsWithRecords = filter (\(_, vd) -> _isRecord vd) listOfMappings
                    mapNames = map fst listOfMappingsWithRecords
                    parents' = c ^. parents
                    parentContracts = getContractsForParents parents' (cc^.contracts)
                    parentAbstractContracts = filter (\contract -> _contractType contract == AbstractType) parentContracts
                    parentAbstractContractsName = map (labelToText ._contractName) parentAbstractContracts
              

                let historyTableNames = map (historyTableName o a') hl
                $logInfoS "processTheMessages/historyTableNames" $ T.pack $ show historyTableNames

                $logInfoS "processTheMessages" $ "New Contract Added: org=" <> o <> ", app=" <> a' <> ", name=" <> n <> " (fields: " <> T.pack (show $ Map.toList $ fmap _varType $ c ^. storageDefs) <> ")"
                let nameParts = (o, a', n)

                --Create mapping tables
                forM_ mapNames $ \m -> do 
                  outputData conn $ createMappingTable g nameParts (T.pack m) --Tables are created

-- mark        

                deferredForeignKeys <- case (_contractType c ) of
                  AbstractType -> do
                    outputData conn $ createAbstractTable g c (o, a', n)
                    return []
                  _ -> do
                    outputData conn $ createExpandIndexTable g c nameParts
                
                outputData' conn $ createExpandHistoryTable g c nameParts

                outputData conn $ createExpandEventTables g c nameParts
                
                when(length parentAbstractContractsName >=1 ) $ do outputData conn $ createAbstractTableRow g c (o, a', n) (head parentAbstractContractsName)

  
                return deferredForeignKeys

              forM_ deferredForeignKeys $ \deferredForeignKey -> do
                outputData conn $ createForeignIndexesForJoins deferredForeignKey
              pure $ Right deferredForeignKeys

      Left cc -> do
        $logInfoS "processTheMessages" $ T.pack cc
        pure $ Left cc -- Either String String

  let fkeys = rights fkeys'

  inserts <- enterBloc2 env $ do
    forM changes $ \(acct,actions) -> do
      let row = combineActions actions
      mapM_ recordAction actions
      recordCombinedAction row
      $logInfoS "processTheMessages" $ "Combined Action = " <> formatAction row
      $logDebugS "processTheMessages" $ T.pack $ "the diff is " ++ format (actionStorage row)

      case actionStorage row of
        Action.EVMDiff{} -> pure $ Left "EVM code indexing ignored"
        Action.SolidVMDiff{} -> do
          let cid = maybe "" (T.pack . chainIdString . ChainId) $ (actionAccount row ^. accountChainId)
              -- (SolidVMCode name _) = actionCodeHash row
              name = case actionCodeHash row of
                SolidVMCode name' _ -> name'
                _ -> error "internal error: contract should be SolidVM for SolidVM"
              abiid = ABIID {
                aiName = T.pack name,
                aiChain = cid
              }
              cont = error "internal error: contract should be unused for SolidVM"
          $logDebugLS "Contract name is: " $ show name
          oldState <- readPreviousSolidVMState g acct
          indexContract <- rowToInsert g abiid row cont oldState
          stateDiff <- rowToMappings row
          mapNames <- getMappingTables g (SE.organization indexContract) (SE.application indexContract) (SE.contractName indexContract)
          abstracts <- getAbstractTableRow g (SE.organization indexContract) (SE.application indexContract) (SE.contractName indexContract)
          --get columns for abstract table
          abstractColumns <- case abstracts of
                              [] -> return Nothing
                              (firstAbstract:_) -> do
                                case  (SE.application indexContract) of
                                  "" -> getTableColumns g $ AbstractTableName (SE.organization indexContract) (SE.contractName indexContract) firstAbstract
                                  _ -> getTableColumns g $ AbstractTableName (SE.organization indexContract) (SE.application indexContract) firstAbstract
          
          $logDebugLS "Globals: Recorded Map names are: " . T.pack $ show mapNames ++ " contract: " ++ show (contractName indexContract)
          hs <- rowToHistories g abiid actions cont oldState
          $logDebugLS "History inserts are: " $ show hs
          pMappings <- processedContractToProcessedMappingRows stateDiff (mapNames) row abiid--get all mapping rows to insert
          if null abstracts
            then pure . Right $ BatchedInserts
             indexContract Nothing hs pMappings
          else
            case abstractColumns of 
              Just abC -> do
                let finalColumns = map extractTextInsideQuotes abC
                pure . Right $ BatchedInserts indexContract (Just (indexContract, head abstracts, finalColumns)) hs pMappings
              Nothing -> pure . Right $ BatchedInserts indexContract Nothing hs pMappings
            

  forM_ (lefts inserts) $ $logErrorS "processTheMessages"

  -- TODO: might need to group inserts by TableName
  let insertsByCodeHash = map snd
                        -- SolidVM contracts can have the same codehash and be different:
                        -- the codehash is just a sourcehash.
                        . partitionWith (SE.codehash . indexInsert &&& SE.contractName . indexInsert)
                        $ rights inserts
  forM_ (rights inserts) $ $logDebugLS "processTheMessages/toInsert"
  forM_ insertsByCodeHash $ \ins -> do
    unless (null ins) $ outputData conn . insertIndexTable $ map indexInsert ins
    outputData conn . insertHistoryTable $ concatMap historyInserts ins
    unless ((length (concatMap mappingInserts ins) < 1) ) $ outputData conn . insertMappingTable $ concatMap mappingInserts ins
    unless (null ins) $ outputData conn . insertAbstractTable $ map abstractInsert ins

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

generateAssetTable :: (MonadLogger m, HasSQL m) =>
                      PGConnection -> IORef Globals -> m ()
generateAssetTable conn g = do
  outputData conn $ createAssetTable g

generateSaleTable :: (MonadLogger m, HasSQL m) =>
                      PGConnection -> IORef Globals -> m ()
generateSaleTable conn g = do
  outputData conn $ createSaleTable g

generateUserTable :: (MonadLogger m, HasSQL m) =>
                      PGConnection -> IORef Globals -> m ()
generateUserTable conn g = do
  outputData conn $ createUserTable g

extractTextInsideQuotes :: T.Text -> T.Text
extractTextInsideQuotes input =
    case T.stripPrefix "\"" input of
        Just rest ->
            case T.break (== '"') rest of
                (extracted, _) -> extracted
        Nothing -> ""
