{-# LANGUAGE
      DataKinds
    , DeriveGeneric
    , FlexibleContexts
    , GeneralizedNewtypeDeriving
    , OverloadedStrings
    , QuasiQuotes
    , RecordWildCards
    , ScopedTypeVariables
    , TemplateHaskell
    , TupleSections
#-}

module Slipstream.Processor
  ( processTheMessages
  , parseActions -- For testing
  ) where

import Control.Arrow ((&&&))
import Control.Applicative
import Control.Monad.Except
import Control.Monad.Trans.Maybe
import Control.Monad.Trans.State.Strict hiding (state)
import Control.Monad.Trans.Class (lift)
import qualified Data.Aeson as JSON
import Data.Bifunctor (second)
import Data.ByteString (ByteString)
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import qualified Data.ByteString.Short as SB
-- import qualified Data.ByteString.Char8 as C8
import Data.Either (lefts, rights)
import Data.Int (Int32)
import Data.IORef
import Data.Function
import Data.List (foldl', sortOn)
import qualified Data.Map.Ordered as OMap
import qualified Data.Map as Map
import Data.Monoid ((<>))
import Data.Maybe
import Data.Ord (Down(..))
import qualified Data.Text as T
import Data.Text (Text)
import Data.Text.Encoding (decodeUtf8)
import Database.PostgreSQL.Typed (PGConnection)

import Blockapps.Crossmon

import BlockApps.Bloc22.Database.Queries
import BlockApps.Bloc22.Monad
import BlockApps.Bloc22.Server.Utils
import BlockApps.Ethereum
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
import Blockchain.Strato.Model.CodePtr (codePtrToSHA)
import Blockchain.Strato.Model.SHA (hash)


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
emptyHash :: SHA
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

makeFunctionInserts :: Xabi
                    -> ABIID
                    -> Map.Map Text Value
                    -> AggregateAction
                    -> Bloc [ProcessedContract]
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


-- Will also check BlocDB for details, if they are not in the cache 
--   i.e. on node restart
getSolidVMDetails :: IORef Globals -> AggregateAction -> Bloc (Maybe (Text, Text))
getSolidVMDetails g row = do
  mDetails <- getCachedSolidVMDetails g row
  case mDetails of
    Just _ -> return mDetails
    Nothing -> do 
      blocDetails <- getContractDetailsByCodeHash $ actionCodeHash row
      case blocDetails of
        Nothing -> return Nothing
        Just (_, deets) -> do
          detailsMap <- sourceToContractDetails False (contractdetailsSrc deets)
          setSolidVMABIs g (actionCodeHash row) detailsMap
          getSolidVMABIs g (actionCodeHash row)
         

-- Note: This could be reshaped to remove the bloch dependency, as
-- we only care about the ABI from `sourceToContractDetails` and
-- not the metadata id. Additionally, at some point this must
-- offload to disk.
getCachedSolidVMDetails :: IORef Globals -> AggregateAction -> Bloc (Maybe (Text, Text))
getCachedSolidVMDetails g row = liftM2 (<|>)
  (getSolidVMABIs g codePtr)
  (runMaybeT $ do
    let md = actionMetadata row
    src <- lookupT "src" md
    detailsMap <- lift $ sourceToContractDetails False src
    setSolidVMABIs g codePtr detailsMap
    MaybeT $ getSolidVMABIs g codePtr
  )
 where codePtr = actionCodeHash row

-- Should now work for both EVM and SolidVM?
detailsForRow :: AggregateAction -> Bloc (Maybe (Int32, ContractDetails))
detailsForRow row = liftM2 (<|>)
  (getContractDetailsByCodeHash $ actionCodeHash row)
  (runMaybeT $ do
    let md = actionMetadata row
    src <- lookupT "src" md
    name <- lookupT "name" md
    detailsMap <- lift $ sourceToContractDetails True src
    lookupT name detailsMap)

adjustGlobals :: IORef Globals -> AggregateAction -> ContractDetails -> Bloc ()
adjustGlobals gref row details = do
  let go m (k,f) = runMaybeT $ do
        v <- lookupT k $ actionMetadata row
        let contracts = filter (not . T.null) $ T.splitOn "," v
        forM_ contracts $ \c -> do
          (_, details') <- lookupT c m
          let codePtr = contractdetailsCodeHash $ details'
          lift $ f gref codePtr

  -- won't actually recompile the contract
  detailsMap <- sourceToContractDetails True $ contractdetailsSrc details
  mapM_ (go detailsMap) $ [("history", addToHistoryList)
                          ,("nohistory", removeFromHistoryList)
                          ,("noindex", addToNoIndexList)
                          ,("index", removeFromNoIndexList)
                          ,("functionhistory", addToFunctionHistoryList)
                          ,("nofunctionhistory", removeFromFunctionHistoryList)
                          ]

ensureContractInstance :: Int32 -> AggregateAction -> Bloc ()
ensureContractInstance cmId row = do
  let addr = actionAddress row
      chainId = actionTxChainId row
  (mInstance :: Maybe Int32) <- fmap listToMaybe . blocQuery $
    contractInstancesByCodeHash (actionCodeHash row) addr chainId
  when (isNothing mInstance) . void $
    insertContractInstance cmId addr chainId

readPreviousEVMState :: IORef Globals -> Address -> Maybe ChainId -> Contract -> Bloc [(Text, Value)]
readPreviousEVMState gref addr chainId cont = do
  let default' = SVR.decodeValues 0 (typeDefs cont) (mainStruct cont) (const 0) 0
  fromMaybe default' <$> getContractState gref addr chainId

readPreviousSolidVMState :: IORef Globals -> Address -> Maybe ChainId -> Bloc [(Text, Value)]
readPreviousSolidVMState gref addr chainId = fromMaybe [] <$> getContractState gref addr chainId


rowToInsert :: IORef Globals -> ABIID -> AggregateAction -> Contract -> [(Text, Value)]
            -> Bloc ProcessedContract
rowToInsert gref abiid row cont oldState = do
  let newState = case actionStorage row of
                    BS.ActionEVMDiff mp -> SVR.decodeCacheValues cont (flip Map.lookup mp) oldState
                    BS.ActionSolidVMDiff mp -> SolidVM.decodeCacheValues mp oldState
  setContractState gref (actionAddress row) (actionTxChainId row) newState
  return $ processedContract abiid (Map.fromList $ newState) row

rowToHistories :: IORef Globals -> ABIID -> AggregateAction -> [AggregateAction] -> Contract
               -> ContractDetails -> [(Text, Value)]
               -> Bloc ([ProcessedContract], [ProcessedContract])
rowToHistories gref abiid row actions cont details oldState = do
  hist <- isHistoric gref $ actionCodeHash row
  second join . unzip <$> if not hist
    then pure []
    else accumStateT oldState actions $ \hRow -> do
      modify $ case actionStorage hRow of
                  BS.ActionEVMDiff mp -> SVR.decodeCacheValues cont (flip Map.lookup mp)
                  BS.ActionSolidVMDiff mp -> SolidVM.decodeCacheValues mp
      newMap <- gets Map.fromList
      let hInsert = processedContract abiid newMap hRow
      functionHist <- isFunctionHistoric gref $ actionCodeHash hRow
      fInserts <- if not functionHist
                    then pure []
                    else lift $ makeFunctionInserts
                                  (contractdetailsXabi details)
                                  abiid
                                  newMap
                                  hRow
      pure (hInsert, fInserts)

-- Prioritizing with-source actions prevents the issue where updates to contracts
-- at different addresses are lost because the schema has not been seen yet.
withSourceFirst :: (a, [AggregateAction]) -> Down Bool
withSourceFirst = Down . any (Map.member "src" . actionMetadata) . snd

parseActions :: [B.ByteString] -> [((Address, Maybe ChainId), [AggregateAction])]
parseActions = sortOn withSourceFirst
             . splitActions
             . filter matters
             . concatMap (flatten . toAction . BL.fromStrict)

processTheMessages :: BlocEnv -> PGConnection -> IORef Globals -> [B.ByteString] -> LoggingT IO ()
processTheMessages env conn g messages = do

  let changes = parseActions messages

  unless (null messages) $
    $logDebugS "processTheMessages" . T.pack . unlines . map show $ messages

  case length messages of
   0 -> return ()
   1 -> $logInfoS "processTheMessages" "1 message has arrived"
   n -> $logInfoS "processTheMessages" . T.pack $ show n ++ " messages have arrived"

  inserts <- enterBloc2 env $ do
    forM changes $ \((addr,chainId),actions) -> do
      let row = combineActions actions
      mapM_ recordAction actions
      recordCombinedAction row
      $logInfoS "processTheMessages" $ formatAction row
      $logDebugLS "the diff is " $ actionStorage row

      case actionStorage row of
        BS.ActionEVMDiff{} -> do
          mDetails <- detailsForRow row
          case mDetails of
            Nothing -> pure . Left $ "No details found for code hash "
                            <> (T.pack . show $ actionCodeHash row)
                            <> " and no 'src' field found in actionMetadata"
            Just (cmId, details) -> do
              let abiid = ABIID
                    { aiAbi = T.replace "\'" "\'\'" . decodeUtf8 . BL.toStrict
                            . JSON.encode $ contractdetailsXabi details
                    , aiName = T.replace "\"" "" $ contractdetailsName details
                    , aiChain = maybe "" (T.pack . chainIdString) $ actionTxChainId row
                    }
                  cont = either error id . xAbiToContract $ contractdetailsXabi details
              adjustGlobals g row details

              ensureContractInstance cmId row

              oldState <- readPreviousEVMState g addr chainId cont
              indexContract <- rowToInsert g abiid row cont oldState
              (hs, fhs) <- rowToHistories g abiid row actions cont details oldState
              pure . Right $ BatchedInserts indexContract hs fhs
        BS.ActionSolidVMDiff{} -> do
          mName <- getSolidVMDetails g row
          case mName of
            Nothing -> pure . Left $ "No SolidVM details for code hash "
                            <> (T.pack . show $ actionCodeHash row)
                            <> " and no 'src' field found in metadata"
            Just (name, abi) -> do
              let abiid = ABIID abi name $ maybe "" (T.pack . chainIdString) $ actionTxChainId row
                  cont = error "internal error: contract should be unused for solidvm"
                  details = error "internal error: details should be unused for solidvm"
              oldState <- readPreviousSolidVMState g addr chainId
              indexContract <- rowToInsert g abiid row cont oldState
              (hs, fhs) <- rowToHistories g abiid row actions cont details oldState
              pure . Right $ BatchedInserts indexContract hs fhs

  forM_ (lefts inserts) $ $logErrorS "processTheMessages"

  let insertsByCodeHash = map snd
                        -- SolidVM contracts can have the same codehash and be different:
                        -- the codehash is just a sourcehash.
                        . partitionWith (codehash . indexInsert &&& contractName . indexInsert)
                        $ rights inserts
  forM_ (rights inserts) $ $logDebugLS "processTheMessages/toInsert"
  forM_ insertsByCodeHash $ \ins -> do
    outputData conn . createInsertIndexTable g $ map indexInsert ins
    outputData conn . createInsertHistoryTable g $ concatMap historyInserts ins
    outputData conn . createInsertFunctionHistoryTable g $ concatMap functionInserts ins
  flushPendingWrites g
