{-# LANGUAGE
      DataKinds
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
    , TypeOperators
#-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Slipstream.Processor
  ( processTheMessages
  , parseActions -- For testing
  ) where

import Prelude hiding (lookup)
import qualified Data.Aeson                           as Aeson
import Control.Arrow ((&&&))
import Control.Applicative
import Control.Lens ((^.), (.~), (?~))
import Control.Monad.Change.Alter
import Control.Monad.Except
import Control.Monad.IO.Unlift
import Control.Monad.Trans.Maybe
import Control.Monad.Trans.Reader
import Control.Monad.Trans.State.Strict hiding (state)
import Data.Either (lefts, rights)
import Data.Function
import Data.IORef
import Data.List (foldl', sortOn)
import qualified Data.Map as Map
import Data.Maybe
import Data.Ord (Down(..))
import qualified Data.Text as T
import Data.Text (Text)
import Data.Text.Encoding
import Database.PostgreSQL.Typed (PGConnection)

import BlockApps.Bloc22.Database.Queries
import BlockApps.Bloc22.Monad
import BlockApps.Bloc22.Server.Utils
import BlockApps.Logging
import qualified BlockApps.Solidity.Contract as OLD
import BlockApps.Solidity.Parse.Parser
import BlockApps.Solidity.Value
import qualified BlockApps.Solidity.Xabi     as OLD
import SolidVM.Solidity.Xabi
import BlockApps.XAbiConverter
import qualified BlockApps.SolidityVarReader as SVR
import qualified BlockApps.SolidVMStorageDecoder as SolidVM

import Blockchain.Data.AddressStateRef
import Blockchain.Data.AddressStateDB
import Blockchain.Data.TransactionResult
import Blockchain.Data.DataDefs
import Blockchain.Data.Json
import Blockchain.SolidVM.CodeCollectionDB
import Blockchain.Strato.Model.Account
import qualified Blockchain.Strato.Model.Action as Action
import Blockchain.Strato.Model.ChainId
import qualified Blockchain.Strato.Model.Event            as Action
import Blockchain.Strato.Model.Keccak256
import Blockchain.Stream.VMEvent

import CodeCollection hiding (contractName)
import Control.Monad.Change.Modify              hiding (modify)
import Control.Monad.Composable.BlocSQL
import Control.Monad.Composable.SQL
import Control.Monad.Composable.CoreAPI
import qualified Handlers.AccountInfo            as Account

import Data.Source.Map

import SelectAccessible                         ()

import Slipstream.Data.Action
import Slipstream.Events
import Slipstream.Globals
import Slipstream.Metrics
import Slipstream.OutputData
import Slipstream.XabiContract
import Slipstream.Options

instance ( (Keccak256 `Alters` SourceMap) m
         , MonadLogger m
         , HasBlocEnv m
         , HasBlocSQL m
         ) => Selectable Account OLD.ContractDetails (CoreAPIM m) where
  select _ a = runMaybeT $ do
    (AddressStateRef' r _) <- MaybeT
                            . fmap listToMaybe
                            . blocStrato
                            . Account.getAccountsFilter
                            $ Account.accountsFilterParams
                            & Account.qaAddress ?~ (a ^. accountAddress)
                            & Account.qaChainId .~ (fmap ChainId . maybeToList $ a ^. accountChainId)
    codePtr <- MaybeT . pure $ addressStateRefCodePtr r
    MaybeT $ either (const Nothing) (\d -> Just d{OLD.contractdetailsAccount = Just a}) <$> getContractDetailsByCodeHash codePtr

instance (Keccak256 `Alters` SourceMap) m => (Keccak256 `Alters` SourceMap) (CoreAPIM m) where
  lookup p   = lift . lookup p
  insert p k = lift . insert p k
  delete p   = lift . delete p

instance (Keccak256 `Alters` SourceMap) m => (Keccak256 `Alters` SourceMap) (ReaderT BlocEnv m) where
  lookup p   = lift . lookup p
  insert p k = lift . insert p k
  delete p   = lift . delete p

instance (MonadUnliftIO m, MonadLogger m) => (Keccak256 `Alters` SourceMap) (BlocSQLM m) where
  lookup _   = contractBySourceHash
  insert _   = insertContractSourceQuery
  delete _ _ = error "Cannot delete from contractsSourceTable"

instance (MonadIO m, MonadLogger m) => Selectable Account AddressState (CoreAPIM m) where
  select _ a = runMaybeT $ do
    (AddressStateRef' r _) <- MaybeT
                            . fmap listToMaybe
                            . blocStrato
                            . Account.getAccountsFilter
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

diffNull :: Action.DataDiff -> Bool
diffNull (Action.EVMDiff m) = Map.null m
diffNull (Action.SolidVMDiff m) = Map.null m

mergeDiffs :: Action.DataDiff -> Action.DataDiff -> Action.DataDiff
mergeDiffs (Action.EVMDiff lhs) (Action.EVMDiff rhs) = Action.EVMDiff $ lhs <> rhs
mergeDiffs (Action.SolidVMDiff lhs) (Action.SolidVMDiff rhs) = Action.SolidVMDiff $ lhs <> rhs
mergeDiffs lhs rhs = error $ "Invalid diff combination: " ++ show (lhs, rhs)

data BatchedInserts = BatchedInserts
  { indexInsert     :: ProcessedContract
  , historyInserts  :: [ProcessedContract]
  , eventCreations  :: [EventTable]
  } deriving (Show)

enterBloc2 :: MonadIO m => r -> BlocSQLEnv -> CoreAPIM (ReaderT r (ReaderT BlocSQLEnv m)) a -> m a
enterBloc2 blocEnv sqlEnv f =
  runBlocSQLMUsingEnv sqlEnv
  $ flip runReaderT blocEnv
  $ runCoreAPIM "http://strato:3000/eth/v1.2"
  $ f

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

lookupT :: (Monad m, Ord k) => k -> Map.Map k v -> MaybeT m v
lookupT k = MaybeT . return . Map.lookup k

-- Tries to get contract metadata ID and contract details for a given contract.
--  If they're not in the cache but they are in bloc database or action metadata,
--  it reparses the whole source blob, and caches the details for every contract
getSolidVMDetailsForRow :: ( MonadIO m
                           , MonadLogger m
                           , Accessible BlocEnv m
                           , HasBlocSQL m
                           , Selectable Account AddressState m
                           , (Keccak256 `Alters` SourceMap) m
                           )
                        => IORef Globals -> AggregateAction -> m (Maybe OLD.ContractDetails)
getSolidVMDetailsForRow g row = runMaybeT  
   $  checkCache 
  <|> checkBloc 
  <|> checkMetadata
  
  where checkCache = do
          $logInfoS "getDetailsForRow" . T.pack $ "checking cache for contract details"
          (MaybeT $ getContractABIs g codePtr) >>= (lookupT $ T.pack name)
        
        checkBloc = do
          $logInfoS "getDetailsForRow" . T.pack $ "checking bloc database for contract details"
          (MaybeT $ either (const Nothing) Just <$> getContractDetailsByCodeHash codePtr) >>= (parseAndSet . OLD.contractdetailsSrc)
        
        checkMetadata = do
          $logInfoS "getDetailsForRow" . T.pack $ "checking metadata for contract details"
          (lookupT "src" $ actionMetadata row) >>= parseAndSet . deserializeSourceMap
        

        -- parse source code, add all of details to cache, return the one we need
        parseAndSet src = do
          detailsMap <- lift $ sourceToContractDetails (Don't Compile) src
          setContractABIs g codePtr detailsMap
          lookupT (T.pack name) detailsMap
          
        codePtr@(SolidVMCode name _) = actionCodeHash row



-- For now, EVM details are not cached, because the cache links all the contracts in a source blob by source hash, and we only have source hashes for SolidVM code pointers. 
getEVMDetailsForRow :: ( MonadIO m
                       , MonadLogger m
                       , Accessible BlocEnv m
                       , HasBlocSQL m
                       , Selectable Account AddressState m
                       , (Keccak256 `Alters` SourceMap) m
                       )
                    => AggregateAction -> m (Maybe OLD.ContractDetails)
getEVMDetailsForRow row = liftM2 (<|>)
  (fmap (either (const Nothing) Just) . getContractDetailsByCodeHash $ actionCodeHash row)
  (runMaybeT $ do
    let md = actionMetadata row
    src <- lookupT "src" md
    name <- lookupT "name" md
    detailsMap <- lift . sourceToContractDetails (Do Compile) $ deserializeSourceMap src
    lookupT name detailsMap)



-- we want adjustGlobals to use cache and not recompile where possible, so we need the cache to link all contracts that share a source, and at the moment, we can only do this with SolidVMCode pointers
adjustGlobals :: ( MonadIO m
                 , MonadLogger m
                 , HasBlocSQL m
                 , (Keccak256 `Alters` SourceMap) m
                 )
              => IORef Globals
              -> Should Compile
              -> AggregateAction
              -> OLD.ContractDetails
              -> m ()
adjustGlobals gref shouldCompile row details = do
  -- TODO: because this uses HistoryTableName directly - this won't work if we add other (non-history) globals
  let go m (k,f) = runMaybeT $ do
        v <- lookupT k $ actionMetadata row
        let contracts' = filter (not . T.null) $ T.splitOn "," v
        forM_ contracts' $ \c -> do
          details' <- lookupT c m
          let codePtr = OLD.contractdetailsCodeHash details'
          $logInfoS "adjustGlobals" . T.pack $ "Adding to globals for " ++ T.unpack k ++ ": " ++ show codePtr
          lift $ f gref $ HistoryTableName (actionOrganization row) (actionApplication row) (OLD.contractdetailsName details')
 

  -- if we pass Don't Compile, we assume it's SolidVMCode, and use details from cache
  detailsMap <- case shouldCompile of
    Do Compile -> sourceToContractDetails shouldCompile $ OLD.contractdetailsSrc details
    Don't Compile -> do 
      mMap <- getContractABIs gref (actionCodeHash row)
      case mMap of
        Nothing -> error "solidVMABIs should be in the cache, but adjustGlobals didn't find them"
        Just dMap -> return dMap
  
  -- TODO: ideally we check if these flags are in the metadata BEFORE we get the detailsMap
  mapM_ (go detailsMap) $ [("history", enableHistoryTable)
                          ,("nohistory", disableHistoryTable)
                          ]

readPreviousEVMState :: MonadIO m =>
                        IORef Globals -> Account -> OLD.Contract -> m [(Text, Value)]
readPreviousEVMState gref acct cont = do
  let default' = SVR.decodeValues 0 (OLD.typeDefs cont) (OLD.mainStruct cont) (const 0) 0
  fromMaybe default' <$> getContractState gref acct

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

rowToHistories :: (MonadIO m, MonadLogger m) =>
                  IORef Globals -> ABIID -> AggregateAction -> [AggregateAction] -> OLD.Contract
               -> [(Text, Value)]
               -> m [ProcessedContract]
rowToHistories gref abiid row actions cont oldState = do
  hist <- isHistoric gref $ HistoryTableName (actionOrganization row) (actionApplication row) (aiName abiid)
  if not hist
    then pure []
    else flip evalStateT oldState . forM actions $ \hRow -> do
      modify $ case actionStorage hRow of
                  Action.EVMDiff mp -> SVR.decodeCacheValues cont (flip Map.lookup mp)
                  Action.SolidVMDiff mp -> SolidVM.decodeCacheValues mp
      newMap <- gets Map.fromList
      return $ processedContract abiid newMap hRow


-- Parses xabi event declarations to create a table,
-- ignoring indexes and anonymous flag
createEvents :: Monad m =>
                OLD.ContractDetails -> Text -> Text -> m [EventTable]
createEvents details org app = do
  let events' = OLD.xabiEvents $ OLD.contractdetailsXabi details
  return $ map makeEvent $ Map.toList events'
  where
    makeEvent :: (Text, OLD.Event) -> EventTable 
    makeEvent (name, event) = 
      EventTable
      { eventOrganization = org
      , eventApplication  = app
      , eventContractName = OLD.contractdetailsName details
      , eventName = name
      , eventFields = map fst $ OLD.eventLogs event
      }
      

contractToEventTables :: (Text, Text, Text) -> Contract -> [EventTable]
contractToEventTables (o, a, n) c =
  flip map (Map.toList $ c^.events) $
      \(eName, fields) ->
        EventTable {
          eventOrganization = o,
          eventApplication  = a,
          eventContractName = n,
          eventName = eName,
          eventFields = map fst $ eventLogs fields
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

parseEvents :: [VMEvent] -> [Action.Event]
parseEvents events' = [a | EventEmitted a <- events']

getCodeCollection' :: MonadIO m => Bool -> CodePtr -> Text -> m CodeCollection
getCodeCollection' True = getCodeCollection (Map.fromList . map (\(x, y) -> (T.unpack x, xabiToPartialContract y)) )
getCodeCollection' False = getCodeCollection (const Map.empty)

getCodeCollection :: MonadIO m => ([(Text, OLD.Xabi)] -> Map.Map String Contract) -> CodePtr -> Text -> m CodeCollection
getCodeCollection f cp ccString = do
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
    SolidVMCode _ _ ->
      case compileSource $ Map.fromList initList of
        Left e -> error $ "failed parse: "  ++ show e --return $ CodeCollection Map.empty
        Right v -> return v
    EVMCode _ ->
      case parseXabi "--" $ T.unpack $ sourceBlob $ SourceMap initList of
        Left e ->
          --return $ CodeCollection Map.empty
          error $ "failed EVM parse: " ++ show e ++ "\n" ++ T.unpack ccString
        Right v -> return $ CodeCollection $ f $ snd v
    CodeAtAccount _ _ -> error "no compilo codeataccount"

getEVMInserts :: (
  MonadIO m, 
  MonadUnliftIO m, 
  MonadLogger m,
  Accessible BlocEnv m,
  HasBlocSQL m,
  Selectable Account AddressState m,
  (Keccak256 `Alters` SourceMap) m) => IORef Globals -> AggregateAction -> [AggregateAction] -> Account -> m (Either Text BatchedInserts)
getEVMInserts g row actions acct = do
  mDetails <- getEVMDetailsForRow row
  case mDetails of
    Nothing -> pure . Left $ "No details found for code hash "
                    <> (T.pack . show $ actionCodeHash row)
                    <> " and no 'src' field found in actionMetadata"
    Just details -> do
      let abiid = ABIID
            { aiName = T.filter (/= '"') $ OLD.contractdetailsName details
            , aiChain = maybe "" (T.pack . chainIdString . ChainId) $ (actionAccount row ^. accountChainId)
            }
          cont = either error id . xAbiToContract $ OLD.contractdetailsXabi details
      adjustGlobals g (Do Compile) row details

      oldState <- readPreviousEVMState g acct cont
      indexContract <- rowToInsert g abiid row cont oldState
      hs <- rowToHistories g abiid row actions cont oldState
      pure . Right $ BatchedInserts indexContract hs []

getInsertsIgnoreEVM :: (Monad m) => IORef Globals -> AggregateAction -> [AggregateAction] -> Account -> m (Either Text BatchedInserts)
getInsertsIgnoreEVM _ _ _ _ = pure $ Left "EVM code indexing ignored"

processTheMessages :: (MonadIO m, MonadUnliftIO m, MonadLogger m, HasSQL m) =>
                      BlocEnv -> BlocSQLEnv -> PGConnection -> IORef Globals -> [VMEvent] -> m ()
processTheMessages env sqlEnv conn g messages = do

  let changes = parseActions messages
      events' = parseEvents messages
      -- TODO (Dan) : would be nice if we didn't just rip events out at the top level like this
      creates = [(c, cp, o, a, hl) | CodeCollectionAdded c cp o a hl <- messages]
      transactionResults = [tr | NewTransactionResult tr <- messages]
      -- Use different functions based on flag value, this way it is only computed once, saving cpu cycles with if statements
      getCC = getCodeCollection' flags_indexEVM
      evmInserts = if flags_indexEVM then getEVMInserts else getInsertsIgnoreEVM

  forM_ creates $ \(ccString, cp, o, a, hl) -> do
    cc <- getCC cp ccString

    deferredForeignKeys <- fmap concat $ forM (Map.toList $ cc^.contracts) $ \(nameString, c) -> do
      let n = T.pack nameString

      --If the request gives this a history list, or if a previous one gave this a history list,
      --it has a history list
      historic <- isHistoric g $ historyTableName o a n
      let hasHistoryTable' = n `elem` hl || historic
      
      $logInfoS "processTheMessages" $ "New Contract Added: org=" <> o <> ", app=" <> a <> ", name=" <> n <> " (fields: " <> T.pack (show $ Map.keys $ c^.storageDefs) <> ")" <> if hasHistoryTable' then " HAS HISTORY TABLE" else ""
      let nameParts = (o, a, n)

      deferredForeignKeys <- outputData conn $ createExpandIndexTable g c nameParts

      when hasHistoryTable' $
        outputData conn $ createExpandHistoryTable g c nameParts

      outputData conn . createEventTables g $ contractToEventTables nameParts c

      return deferredForeignKeys

    forM_ deferredForeignKeys $ \deferredForeignKey -> do
      outputData conn $ createForeignIndexesForJoins deferredForeignKey



  case length messages of
   0 -> return ()
   1 -> $logInfoS "processTheMessages" "1 message has arrived"
   n -> $logInfoS "processTheMessages" . T.pack $ show n ++ " messages have arrived"

  inserts <- enterBloc2 env sqlEnv $ do
    forM changes $ \(acct,actions) -> do
      let row = combineActions actions
      mapM_ recordAction actions
      recordCombinedAction row
      $logInfoS "processTheMessages" $ "Combined Action = " <> formatAction row
      $logDebugLS "the diff is " $ actionStorage row

      case actionStorage row of
        Action.EVMDiff{} -> evmInserts g row actions acct
        Action.SolidVMDiff{} -> do
          mName <- getSolidVMDetailsForRow g row
          case mName of
            Nothing -> pure . Left $ "No SolidVM details for code hash "
                            <> (T.pack . show $ actionCodeHash row)
                            <> " and no 'src' field found in metadata"
            Just details -> do
              let name = T.filter (/= '"') $ OLD.contractdetailsName details
                  abiid = ABIID name $ maybe "" (T.pack . chainIdString . ChainId) $ (actionAccount row ^. accountChainId)
                  cont = error "internal error: contract should be unused for solidvm"

              adjustGlobals g (Don't Compile) row details
              oldState <- readPreviousSolidVMState g acct
              indexContract <- rowToInsert g abiid row cont oldState
              hs <- rowToHistories g abiid row actions cont oldState
              eventTables <- createEvents details (actionOrganization row) (actionApplication row)
              pure . Right $ BatchedInserts indexContract hs eventTables


  forM_ (lefts inserts) $ $logErrorS "processTheMessages"

  -- TODO: might need to group inserts by TableName
  let insertsByCodeHash = map snd
                        -- SolidVM contracts can have the same codehash and be different:
                        -- the codehash is just a sourcehash.
                        . partitionWith (codehash . indexInsert &&& contractName . indexInsert)
                        $ rights inserts
  forM_ (rights inserts) $ $logDebugLS "processTheMessages/toInsert"
  forM_ insertsByCodeHash $ \ins -> do
    unless (null ins) $ outputData conn . insertIndexTable $ map indexInsert ins
    outputData conn . insertHistoryTable g $ concatMap historyInserts ins

  forM_ insertsByCodeHash $ \ins -> do
    unless (null ins) $ outputData conn . insertForeignKeys $ map indexInsert ins

  when (length events' > 0) $ 
    outputData conn $ insertExpandEventTables g events'

  $logInfoS "processTheMessages" . T.pack $ "inserting " ++ show (length transactionResults) ++ " transaction results"

  forM_ transactionResults $ putTransactionResult
  
  flushPendingWrites g
  
