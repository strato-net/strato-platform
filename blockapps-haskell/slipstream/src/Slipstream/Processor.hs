{-# LANGUAGE
      DataKinds
    , DeriveGeneric
    , FlexibleContexts
    , FlexibleInstances
    , GeneralizedNewtypeDeriving
    , LambdaCase
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
  , parseActions -- For testing
  ) where

import Conduit
import Control.Arrow ((&&&), (***))
import Control.Applicative
import qualified Control.Monad.Change.Alter as A
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Reader
import Control.Monad.Trans.Maybe
import Control.Monad.Trans.State.Strict hiding (state)
import Control.Monad.Trans.Class (lift)
import qualified Data.Aeson as JSON
import Data.Bifunctor (second)
import Data.ByteString (ByteString)
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import qualified Data.ByteString.Short as SB
--import Data.Conduit
-- import qualified Data.ByteString.Char8 as C8
import Data.Either (lefts, rights)
import Data.Function
--import Data.Foldable
--import Data.Traversable
import Data.Int (Int32)
import Data.IORef
import Data.List (foldl', sortOn)
import qualified Data.Map.Ordered as OMap
import qualified Data.Map as Map
import Data.Map (Map)
import Data.Monoid ((<>))
import Data.Maybe
import Data.Ord (Down(..))
import qualified Data.Text as T
import Data.Text (Text)
import Database.PostgreSQL.Typed (PGConnection)

import Blockapps.Crossmon

import BlockApps.Bloc22.Database.Queries
import BlockApps.Bloc22.Monad
import BlockApps.Bloc22.Server.Utils
import BlockApps.Logging
import BlockApps.Solidity.Contract
import BlockApps.Solidity.Type
import BlockApps.Solidity.Struct
import BlockApps.Solidity.Value
import BlockApps.Solidity.Xabi
import BlockApps.XAbiConverter
import qualified BlockApps.SolidityVarReader as SVR
import qualified BlockApps.SolidVMStorageDecoder as SolidVM

import qualified Blockchain.Strato.Model.Action as BS
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.Keccak256

import Slipstream.Data.Action
import Slipstream.Events
import Slipstream.Globals
import Slipstream.Metrics
import Slipstream.OutputData
import Slipstream.SolidityValue

diffNull :: BS.ActionDataDiff -> Bool
diffNull (BS.ActionEVMDiff m) = Map.null m
diffNull (BS.ActionSolidVMDiff m) = Map.null m

mergeDiffs :: BS.ActionDataDiff -> BS.ActionDataDiff -> BS.ActionDataDiff
mergeDiffs (BS.ActionEVMDiff lhs) (BS.ActionEVMDiff rhs) = BS.ActionEVMDiff $ lhs <> rhs
mergeDiffs (BS.ActionSolidVMDiff lhs) (BS.ActionSolidVMDiff rhs) = BS.ActionSolidVMDiff $ lhs <> rhs
mergeDiffs lhs rhs = error $ "Invalid diff combination: " ++ show (lhs, rhs)

data BatchedInserts = BatchedInserts
  { indexInsert     :: ProcessedContract
  , historyInserts  :: [ProcessedContract]
  , functionInserts :: [ProcessedContract]
  , eventCreations  :: [EventTable]
  } deriving (Show)

toAction :: BL.ByteString -> Action
toAction x =
 case JSON.eitherDecode x of
  Left e -> error $ show e
  Right y -> y

enterBloc2 :: BlocEnv -> Bloc x -> LoggingT IO x
enterBloc2 env x = do
  ret <- liftIO $ runBlocToIO env x

  case ret of
   Left e -> error $ show e
   Right v -> return v

{-# NOINLINE emptyHash #-}
emptyHash :: Keccak256
emptyHash = hash B.empty

matters :: AggregateAction -> Bool
matters AggregateAction{..} = (actionType == Create || (not $ diffNull actionStorage))
                           && (codePtrToSHA actionCodeHash /= emptyHash)

-- assumes all Actions in the list are for the same (Address, Maybe ChainId) pair
combineActions :: [AggregateAction] -> AggregateAction
combineActions [] = error "cannot combine 0 actions"
combineActions (x:xs) = foldl' merge x xs
  where
    merge a b = b { actionStorage  = (mergeDiffs `on` actionStorage) b a
                  , actionMetadata = (Map.union `on` actionMetadata) b a
                  }

splitActions :: [AggregateAction] -> [((Address, Maybe ChainId), [AggregateAction])]
splitActions = partitionWith (actionAddress &&& actionTxChainId)

functionDetailsFromContract :: Contract -> ByteString -> (Text, ([(Text, Type)],[(Maybe Text, Type)]))
functionDetailsFromContract contract selector' =
  let selector = B.take 4 selector'
      isSelector = \case
        TypeFunction s a r | s == selector -> Just (a,r)
        _                                  -> Nothing
   in fromMaybe ("",([],[]))
      . listToMaybe
      . map (fmap fromJust)
      . filter (isJust . snd)
      . map (fmap (isSelector . snd))
      $ OMap.assocs
        (fields $ mainStruct contract)

getFunctionDetailsFromSelector :: Xabi -> ByteString -> (Text, ([(Text,Type)],[(Maybe Text, Type)]))
getFunctionDetailsFromSelector xabi sel' = case xAbiToContract xabi of
  Left err -> error $ "getFunctionDetailsFromSelector: " ++ err
  Right contract' -> functionDetailsFromContract contract' sel'

convertEnumTypeToInt :: Type -> Type
convertEnumTypeToInt = \case
  TypeEnum _ -> SimpleType $ TypeInt False $ Just 32
  TypeArrayFixed n ty -> TypeArrayFixed n (convertEnumTypeToInt ty)
  TypeArrayDynamic ty -> TypeArrayDynamic (convertEnumTypeToInt ty)
  ty -> ty

convertByteStringToVals :: ByteString -> [Type] -> Maybe [SolidityValue]
convertByteStringToVals byteResp responseTypes = map valueToSolidityValue <$> bytestringToValues byteResp responseTypes

getFunctionCallValues :: Xabi -> ByteString -> ByteString -> (Text, [(Text, SolidityValue)], [(Text, SolidityValue)])
getFunctionCallValues xabi input' output' =
  let sel = B.take 4 input'
      data' = B.drop 4 input'
      (fname,(itypes,otypes)) = getFunctionDetailsFromSelector xabi sel
      typemap bs = uncurry zip
                   . fmap ( fromMaybe (repeat (SolidityValueAsString ""))
                     . convertByteStringToVals bs
                     . map convertEnumTypeToInt
                   ) . unzip
      imap = typemap data' itypes
      omap = zipWith
               (\i (n,v) -> (fromMaybe (T.pack $ '#':show i) n, v))
               ([0..] :: [Integer])
               (typemap output' otypes)
   in (fname,imap,omap)

data ABIID = ABIID { aiAbi :: Text
                   , aiName :: Text
                   , aiChain :: Text
                   } deriving (Eq, Show)

processedContract :: ABIID
                  -> Map.Map Text Value
                  -> AggregateAction
                  -> ProcessedContract
processedContract ABIID{..} state AggregateAction{..} =
  ProcessedContract
    { address = actionAddress
    , codehash = actionCodeHash
    , abi = aiAbi
    , contractName = aiName
    , chain = aiChain
    , contractData = state
    , blockHash = actionBlockHash
    , blockTimestamp = actionBlockTimestamp
    , blockNumber = actionBlockNumber
    , transactionHash = actionTxHash
    , transactionSender = actionTxSender
    , functionCallData = Nothing
    }

makeFunctionInserts :: MonadIO m
                    => Xabi
                    -> ABIID
                    -> Map.Map Text Value
                    -> AggregateAction
                    -> m [ProcessedContract]
makeFunctionInserts xabi ABIID{..} state AggregateAction{..} =
  forM actionCallData $ \CallData{..} -> do
    let ibytes = SB.fromShort $ _callDataInput
        obytes = SB.fromShort $ fromMaybe SB.empty _callDataOutput
        (f',i,o) = getFunctionCallValues xabi ibytes obytes
        f = if T.null f'
              then if actionType == Create
                    then "constructor"
                    else "fallback"
              else f'
    recordMaxBlockNumber "slipstream_processor" actionBlockNumber
    pure $ ProcessedContract
      { address = actionAddress
      , codehash = actionCodeHash
      , abi = aiAbi
      , contractName = aiName
      , chain = aiChain
      , contractData = state
      , blockHash = actionBlockHash
      , blockTimestamp = actionBlockTimestamp
      , blockNumber = actionBlockNumber
      , transactionHash = actionTxHash
      , transactionSender = actionTxSender
      , functionCallData = Just $ FunctionCallData
          { functioncalldataName = f
          , functioncalldataInput = i
          , functioncalldataOutput = o
          }
      }

lookupT :: (Monad m, Ord k) => k -> Map.Map k v -> MaybeT m v
lookupT k = MaybeT . return . Map.lookup k



-- Tries to get contract metadata ID and contract details for a given contract.
--  If they're not in the cache but they are in bloc database or action metadata,
--  it reparses the whole source blob, and caches the details for every contract
getSolidVMDetailsForRow :: ( MonadLogger m
                           , Mod.Modifiable Globals m
                           , A.Selectable CodePtr (Int32, ContractDetails) m
                           , A.Selectable (Should Compile, Text) (Map Text (Int32, ContractDetails)) m
                           )
                        => AggregateAction -> m (Maybe (Int32, ContractDetails))
getSolidVMDetailsForRow row = runMaybeT  
   $  checkCache 
  <|> checkBloc 
  <|> checkMetadata
  
  where checkCache = do
          $logInfoS "getDetailsForRow" . T.pack $ "checking cache for contract details"
          (MaybeT $ getContractABIs codePtr) >>= (lookupT $ T.pack name)
        
        checkBloc = do
          $logInfoS "getDetailsForRow" . T.pack $ "checking bloc database for contract details"
          (MaybeT $ A.select (A.Proxy @(Int32, ContractDetails)) codePtr) >>= (parseAndSet . contractdetailsSrc . snd)
        
        checkMetadata = do
          $logInfoS "getDetailsForRow" . T.pack $ "checking metadata for contract details"
          (lookupT "src" $ actionMetadata row) >>= parseAndSet
        

        -- parse source code, add all of details to cache, return the one we need
        parseAndSet :: ( Mod.Modifiable Globals m
                       , A.Selectable (Should Compile, Text) (Map Text (Int32, ContractDetails)) m
                       )
                    => Text -> MaybeT m (Int32, ContractDetails)
        parseAndSet src = do
          detailsMap <- lift $ A.selectWithMempty A.Proxy ((Don't Compile), src)
          lift $ setContractABIs codePtr detailsMap
          lookupT (T.pack name) detailsMap
          
        codePtr@(SolidVMCode name _) = actionCodeHash row



-- For now, EVM details are not cached, because the cache links all the contracts in a source blob by source hash, and we only have source hashes for SolidVM code pointers. 
getEVMDetailsForRow :: ( A.Selectable CodePtr (Int32, ContractDetails) m
                       , A.Selectable (Should Compile, Text) (Map Text (Int32, ContractDetails)) m
                       )
                    => AggregateAction -> m (Maybe (Int32, ContractDetails))
getEVMDetailsForRow row = liftM2 (<|>)
  (A.select (A.Proxy @(Int32, ContractDetails)) $ actionCodeHash row)
  (runMaybeT $ do
    let md = actionMetadata row
    src <- lookupT "src" md
    name <- lookupT "name" md
    detailsMap <- lift $ A.selectWithMempty (A.Proxy @(Map Text (Int32, ContractDetails))) (Do Compile, src)
    lookupT name detailsMap)



-- we want adjustGlobals to use cache and not recompile where possible, so we need the cache to link all contracts that share a source, and at the moment, we can only do this with SolidVMCode pointers
adjustGlobals :: ( MonadLogger m
                 , Mod.Modifiable Globals m
                 , A.Selectable (Should Compile, Text) (Map Text (Int32, ContractDetails)) m
                 )
              => Should Compile
              -> AggregateAction
              -> ContractDetails
              -> m ()
adjustGlobals shouldCompile row details = do
  let go m (k,f) = runMaybeT $ do
        v <- lookupT k $ actionMetadata row
        let contracts = filter (not . T.null) $ T.splitOn "," v
        forM_ contracts $ \c -> do
          (_, details') <- lookupT c m
          let codePtr = contractdetailsCodeHash details'
          $logInfoS "adjustGlobals" . T.pack $ "Adding to globals for " ++ T.unpack k ++ ": " ++ show codePtr
          lift $ f codePtr

  -- if we pass Don't Compile, we assume it's SolidVMCode, and use details from cache
  detailsMap <- case shouldCompile of
    Do Compile -> A.selectWithMempty A.Proxy (shouldCompile, contractdetailsSrc details)
    Don't Compile -> do 
      mMap <- getContractABIs (actionCodeHash row)
      case mMap of
        Nothing -> error "solidVMABIs should be in the cache, but adjustGlobals didn't find them"
        Just dMap -> return dMap
  
  -- TODO: ideally we check if these flags are in the metadata BEFORE we get the detailsMap
  mapM_ (go detailsMap) $ [("history", addToHistoryList)
                          ,("nohistory", removeFromHistoryList)
                          ,("noindex", addToNoIndexList)
                          ,("index", removeFromNoIndexList)
                          ,("functionhistory", addToFunctionHistoryList)
                          ,("nofunctionhistory", removeFromFunctionHistoryList)
                          ]

ensureContractInstance :: ( Mod.Modifiable Globals m
                          , A.Replaceable (Address, Maybe ChainId) Int32 m
                          )
                       => Int32 -> AggregateAction -> m ()
ensureContractInstance cmId row = do
  let addr = actionAddress row
      chainId = actionTxChainId row
      codePtr = actionCodeHash row
  instExists <- isInstanceCreated codePtr
  if instExists then
    return ()
  else
    A.replace A.Proxy (addr, chainId) cmId >> setInstanceCreated codePtr

readPreviousEVMState :: (MonadIO m, Mod.Modifiable Globals m) => Address -> Maybe ChainId -> Contract -> m [(Text, Value)]
readPreviousEVMState addr chainId cont = do
  let default' = SVR.decodeValues 0 (typeDefs cont) (mainStruct cont) (const 0) 0
  fromMaybe default' <$> getContractState addr chainId

readPreviousSolidVMState :: (MonadIO m, Mod.Modifiable Globals m) => Address -> Maybe ChainId -> m [(Text, Value)]
readPreviousSolidVMState addr chainId = fromMaybe [] <$> getContractState addr chainId


rowToInsert :: ( MonadIO m
               , Mod.Modifiable Globals m
               )
            => ABIID -> AggregateAction -> Contract -> [(Text, Value)]
            -> m ProcessedContract
rowToInsert abiid row cont oldState = do
  let newState = case actionStorage row of
                    BS.ActionEVMDiff mp -> SVR.decodeCacheValues cont (flip Map.lookup mp) oldState
                    BS.ActionSolidVMDiff mp -> SolidVM.decodeCacheValues mp oldState
  setContractState (actionAddress row) (actionTxChainId row) newState
  return $ processedContract abiid (Map.fromList $ newState) row

rowToHistories :: ( MonadLogger m
                  , MonadIO m
                  , Mod.Modifiable Globals m
                  )
               => ABIID -> AggregateAction -> [AggregateAction] -> Contract
               -> ContractDetails -> [(Text, Value)]
               -> m ([ProcessedContract], [ProcessedContract])
rowToHistories abiid row actions cont details oldState = do
  hist <- isHistoric $ actionCodeHash row
  second join . unzip <$> if not hist
    then pure []
    else flip evalStateT oldState . forM actions $ \hRow -> do
      modify $ case actionStorage hRow of
                  BS.ActionEVMDiff mp -> SVR.decodeCacheValues cont (flip Map.lookup mp)
                  BS.ActionSolidVMDiff mp -> SolidVM.decodeCacheValues mp
      newMap <- gets Map.fromList
      let hInsert = processedContract abiid newMap hRow
      functionHist <- lift . isFunctionHistoric $ actionCodeHash hRow
      fInserts <- if not functionHist
                    then pure []
                    else lift $ makeFunctionInserts
                                  (contractdetailsXabi details)
                                  abiid
                                  newMap
                                  hRow
      pure (hInsert, fInserts)


-- Parses xabi event declarations to create a table,
-- ignoring indexes and anonymous flag
createEvents :: ContractDetails -> [EventTable]
createEvents details =
  let events = xabiEvents $ contractdetailsXabi details
   in map makeEvent $ Map.toList events
  where
    makeEvent :: (Text, Event) -> EventTable 
    makeEvent (name, event) = 
      EventTable
      { eventContractName = contractdetailsName details
      , eventName = name
      , eventFields = map fst $ eventLogs event
      }
      

-- Prioritizing with-source actions prevents the issue where updates to contracts
-- at different addresses are lost because the schema has not been seen yet.
withSourceFirst :: (a, [AggregateAction]) -> Down Bool
withSourceFirst = Down . any (Map.member "src" . actionMetadata) . snd

aggregate :: [Action] -> ([AggregateEvent], [((Address, Maybe ChainId), [AggregateAction])])
aggregate = fmap ( sortOn withSourceFirst
                 . splitActions
                 . filter matters
                 )
          . (concat *** concat)
          . unzip
          . map (squash &&& flatten)

parseActionFromJSON :: B.ByteString -> Action
parseActionFromJSON = toAction . BL.fromStrict

-- only here for tests
parseActions :: [B.ByteString] -> [((Address, Maybe ChainId), [AggregateAction])]
parseActions = snd . aggregate . map parseActionFromJSON

instance (A.Selectable CodePtr (Int32, ContractDetails)) (ReaderT (IORef Globals) Bloc) where
  select _ = lift . getContractDetailsByCodeHash

instance (A.Selectable (Should Compile, Text) (Map Text (Int32, ContractDetails))) (ReaderT (IORef Globals) Bloc) where
  select _ = fmap Just . lift . uncurry sourceToContractDetails

instance (A.Replaceable (Address, Maybe ChainId) Int32) (ReaderT (IORef Globals) Bloc) where
  replace _ (addr, chainId) cmId = void . lift $ insertContractInstance cmId addr chainId

processTheMessages :: BlocEnv -> PGConnection -> IORef Globals -> [B.ByteString] -> LoggingT IO ()
processTheMessages env conn g messages = do

  unless (null messages) $
    $logDebugS "processTheMessages" . T.pack . unlines . map show $ messages
  
  case length messages of
   0 -> return ()
   1 -> $logInfoS "processTheMessages" "1 message has arrived"
   n -> $logInfoS "processTheMessages" . T.pack $ show n ++ " messages have arrived"

  let actions = parseActionFromJSON <$> messages

  enterBloc2 env . flip runReaderT g $ processActions (outputData conn) actions

processActions :: ( MonadLogger m
                  , MonadUnliftIO m
                  , Mod.Modifiable Globals m
                  , A.Selectable CodePtr (Int32, ContractDetails) m
                  , A.Selectable (Should Compile, Text) (Map Text (Int32, ContractDetails)) m
                  , A.Replaceable (Address, Maybe ChainId) Int32 m
                  )
               => (ConduitM () Text m () -> m ())
               -> [Action]
               -> m ()
processActions output actions = do
  let ~(aggEvents, aggActions) = aggregate actions
  inserts <- forM aggActions $ \((a,b),c) -> processAggregateAction a b c

  forM_ (lefts inserts) $ $logErrorS "processTheMessages"

  let insertsByCodeHash = map snd
                        -- SolidVM contracts can have the same codehash and be different:
                        -- the codehash is just a sourcehash.
                        . partitionWith (codehash . indexInsert &&& contractName . indexInsert)
                        $ rights inserts
  forM_ (rights inserts) $ $logDebugLS "processTheMessages/toInsert"
  forM_ insertsByCodeHash $ \ins -> do
    output . createInsertIndexTable $ map indexInsert ins
    output . createInsertHistoryTable $ concatMap historyInserts ins
    output . createInsertFunctionHistoryTable $ concatMap functionInserts ins
    when (length (concatMap eventCreations ins) > 0) $
      output . createEventTables $ concatMap eventCreations ins
  
  when (length aggEvents > 0) $ 
    output $ insertEventTables aggEvents
  flushPendingWrites
  
processAggregateAction
  :: ( MonadLogger m
     , MonadIO m
     , Mod.Modifiable Globals m
     , A.Selectable CodePtr (Int32, ContractDetails) m
     , A.Selectable (Should Compile, Text) (Map Text (Int32, ContractDetails)) m
     , A.Replaceable (Address, Maybe ChainId) Int32 m
     )
  => Address
  -> Maybe ChainId 
  -> [AggregateAction] 
  -> m (Either Text BatchedInserts)
processAggregateAction addr chainId actions = do
  let row = combineActions actions
  mapM_ recordAction actions
  recordCombinedAction row
  $logInfoS "processTheMessages" $ formatAction row
  $logDebugLS "the diff is " $ actionStorage row

  case actionStorage row of
    BS.ActionEVMDiff{} -> do
      mDetails <- getEVMDetailsForRow row
      case mDetails of
        Nothing -> pure . Left $ "No details found for code hash "
                        <> (T.pack . show $ actionCodeHash row)
                        <> " and no 'src' field found in actionMetadata"
        Just (cmId, details) -> do
          let abiid = ABIID
                { aiAbi = xabiToText $ contractdetailsXabi details
                , aiName = T.filter (/= '"') $ contractdetailsName details
                , aiChain = maybe "" (T.pack . chainIdString) $ actionTxChainId row
                }
              cont = either error id . xAbiToContract $ contractdetailsXabi details
          adjustGlobals (Do Compile) row details

          ensureContractInstance cmId row

          oldState <- readPreviousEVMState addr chainId cont
          indexContract <- rowToInsert abiid row cont oldState
          (hs, fhs) <- rowToHistories abiid row actions cont details oldState
          pure . Right $ BatchedInserts indexContract hs fhs []
    BS.ActionSolidVMDiff{} -> do
      mName <- getSolidVMDetailsForRow row
      case mName of
        Nothing -> pure . Left $ "No SolidVM details for code hash "
                        <> (T.pack . show $ actionCodeHash row)
                        <> " and no 'src' field found in metadata"
        Just (cmId, details) -> do
          let abi = xabiToText $ contractdetailsXabi details
              name = T.filter (/= '"') $ contractdetailsName details
              abiid = ABIID abi name $ maybe "" (T.pack . chainIdString) $ actionTxChainId row
              cont = error "internal error: contract should be unused for solidvm"

          ensureContractInstance cmId row
      
          adjustGlobals (Don't Compile) row details
          oldState <- readPreviousSolidVMState addr chainId
          indexContract <- rowToInsert abiid row cont oldState
          (hs, fhs) <- rowToHistories abiid row actions cont details oldState
          let eventTables = createEvents details
          pure . Right $ BatchedInserts indexContract hs fhs eventTables