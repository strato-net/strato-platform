{-# LANGUAGE
      DataKinds
    , DeriveGeneric
    , FlexibleContexts
    , GeneralizedNewtypeDeriving
    , LambdaCase
    , OverloadedStrings
    , QuasiQuotes
    , RecordWildCards
    , ScopedTypeVariables
    , TemplateHaskell
#-}

module Slipstream.Processor where

import Control.Arrow ((&&&))
import Control.Monad.Except
import Control.Monad.Log    hiding (Handler)
import Control.Monad.Reader
import Control.Monad.Trans.State.Strict hiding (state)
import Control.Monad.Trans.Class (lift)
import qualified Data.Aeson as JSON
import Data.ByteString (ByteString)
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.Either (lefts, rights)
import Data.Int (Int32)
import Data.IORef
import Data.Foldable (for_)
import Data.Function
import qualified Data.Map.Ordered as OMap
import qualified Data.Map as Map
import Data.Monoid ((<>))
import Data.Maybe
import qualified Data.Text as T
import Data.Traversable (for)
import Data.Text (Text)
import Data.Text.Encoding (decodeUtf8)
import Database.PostgreSQL.Typed (PGConnection)
import System.Log.Logger

import Blockapps.Crossmon

import BlockApps.Bloc22.Database.Queries
import BlockApps.Bloc22.Monad
import BlockApps.Bloc22.Server.Utils
import BlockApps.Ethereum
import BlockApps.Solidity.Contract
import BlockApps.Solidity.Type
import BlockApps.Solidity.Struct
import BlockApps.Solidity.Value
import BlockApps.Solidity.Xabi
import BlockApps.XAbiConverter
import qualified BlockApps.SolidityVarReader as SVR

import qualified Blockchain.Strato.Model.Action as BS

import Slipstream.Data.Action
import Slipstream.Events
import Slipstream.Globals
import Slipstream.Metrics
import Slipstream.OutputData
import Slipstream.SolidityValue

todoToMap :: BS.ActionDataDiff -> Map.Map Word256 Word256
todoToMap = \case
  BS.ActionEVMDiff m -> m
  BS.ActionSolidVMDiff _ -> error "TODO(tim): Processing not implemented for SolidVM"

data BatchedInserts = BatchedInserts
  { indexInsert     :: ProcessedContract
  , historyInserts  :: [ProcessedContract]
  , functionInserts :: [ProcessedContract]
  }

listHead :: [a] -> [a]
listHead = maybeToList . listToMaybe

toAction :: BL.ByteString -> Action'
toAction x =
 case JSON.eitherDecode x of
  Left e -> error $ show e
  Right y -> y

enterBloc2 :: BlocEnv -> Bloc x -> IO x
enterBloc2 env x = do
  ret <-
    runExceptT
    $ flip runLoggingT (filterPrintLog $ logLevel env)
    $ flip runReaderT env $ runBloc x

  case ret of
   Left e -> error $ show e
   Right v -> return v

emptyHash :: Keccak256
emptyHash = keccak256 B.empty

hasContract::Action->Bool
hasContract = (/= emptyHash) . actionCodeHash

matters :: Action -> Bool
matters Action{..} = (actionType == Create) || (not . Map.null $ todoToMap actionStorage)

on2 :: (b -> b -> c) -> ((a -> a -> b), (a -> a -> b)) -> a -> a -> c
on2 f p = curry ((uncurry f) . ((uncurry (fst p)) &&& (uncurry (snd p))))

isSameCreateAs :: Action -> Action -> Bool
isSameCreateAs = (&&) `on2` (((&&) `on` ((== Create) . actionType)), ((==) `on` actionCodeHash))

groupSimilarActions :: [Action] -> [[Action]]
groupSimilarActions as = go as [] []
  where
    go [] _ final = final
    go [x] tmp final = final ++ [tmp ++ [x]]
    go (x:y:rest) tmp final =
      let newTmp = tmp ++ [x]
       in if isSameCreateAs x y
            then go (y:rest) newTmp final
            else go (y:rest) [] (final ++ [newTmp])

-- assumes all Actions in the list are for the same (Address, Maybe ChainId) pair
combineActions :: [Action] -> Action
combineActions []     = error "combineActions: called with an empty list"
combineActions [x]    = x
combineActions (x:xs) = let y = combineActions xs
                         in merge x y
  where
    merge a b = b { actionStorage  = BS.ActionEVMDiff $ (Map.union `on` todoToMap . actionStorage) b a
                  , actionMetadata = (Map.union `on` actionMetadata) b a
                  }

splitActions :: [Action] -> [((Address, Maybe ChainId), [Action])]
splitActions = partitionWith (actionAddress &&& actionTxChainId)

withNothing :: Applicative f => Maybe a -> f (Maybe a) -> f (Maybe a)
withNothing m f = maybe f (pure . Just) m

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

processedContract :: Text
                  -> Text
                  -> Text
                  -> Map.Map Text Value
                  -> Action
                  -> ProcessedContract
processedContract abi name chain state Action{..} =
  ProcessedContract
    { address = actionAddress
    , codehash = actionCodeHash
    , abi = abi
    , contractName = name
    , chain = chain
    , contractData = state
    , blockHash = actionBlockHash
    , blockTimestamp = actionBlockTimestamp
    , blockNumber = actionBlockNumber
    , transactionHash = actionTxHash
    , transactionSender = actionTxSender
    , functionCallData = Nothing
    }

makeFunctionInserts :: Xabi
                    -> Text
                    -> Text
                    -> Text
                    -> Map.Map Text Value
                    -> Action
                    -> Bloc [ProcessedContract]
makeFunctionInserts xabi abi name chain state Action{..} =
  forM actionCallData $ \CallData{..} -> do
    let ibytes = _input
        obytes = fromMaybe B.empty _output
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
      , abi = abi
      , contractName = name
      , chain = chain
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

processTheMessages :: BlocEnv -> PGConnection -> IORef Globals -> [B.ByteString] -> IO ()
processTheMessages env conn g messages = do

  let changes = splitActions
              . filter matters
              . filter hasContract
              . join
              $ map (flatten . toAction . BL.fromStrict) messages

  unless (null messages) $
    debugM "processTheMessages" . unlines . map show $ messages

  case length messages of
   0 -> return ()
   1 -> infoM "processTheMessages" "1 message has arrived"
   n -> infoM "processTheMessages" $ show n ++ " messages have arrived"

  inserts <- enterBloc2 env $ do
    forM changes $ \((addr,chainId),actions) -> do
      let row = combineActions actions
      mapM_ recordAction actions
      recordCombinedAction row
      liftIO . infoM "processTheMessages" . T.unpack . formatAction $ row

      let md = actionMetadata row
      mcd <- getContractDetailsByCodeHash $ actionCodeHash row
      mDetails <- withNothing mcd $ do
        fmap join . for (Map.lookup "src" md) $ \src -> do
          detailsMap <- sourceToContractDetails True src
          fmap join . for (Map.lookup "name" md) $ \name -> do
            traverse pure $ Map.lookup name detailsMap

      if isNothing mDetails
        then pure . Left $ "No details found for code hash "
                        <> (T.pack . show $ actionCodeHash row)
                        <> " and no 'src' field found in actionMetadata"
        else do
          let Just (cmId,details) = mDetails
              strAbi = T.replace "\'" "\'\'" . decodeUtf8 . BL.toStrict . JSON.encode $ contractdetailsXabi details
              strName = T.replace "\"" "" $ contractdetailsName details
              cont = either error id . xAbiToContract $ contractdetailsXabi details
              chain = maybe "" (T.pack . chainIdString) $ actionTxChainId row
              cache = flip Map.lookup . todoToMap $ actionStorage row
              updateGlobal m (k,f) = for_ (Map.lookup k $ actionMetadata row) $ \v -> do
                let contracts = filter (not . T.null) $ T.splitOn "," v
                forM_ contracts $ \c -> for_ (fmap (contractdetailsCodeHash . snd) $ Map.lookup c m) $ f g

          detailsMap <- sourceToContractDetails True $ contractdetailsSrc details -- won't actually recompile the contract
          mapM_ (updateGlobal detailsMap) $ [("history", addToHistoryList)
                                            ,("nohistory", removeFromHistoryList)
                                            ,("noindex", addToNoIndexList)
                                            ,("index", removeFromNoIndexList)
                                            ,("functionhistory", addToFunctionHistoryList)
                                            ,("nofunctionhistory", removeFromFunctionHistoryList)
                                            ]

          (mInstance :: Maybe Int32) <- fmap listToMaybe . blocQuery $
            contractInstancesByCodeHash (actionCodeHash row) addr chainId
          when (isNothing mInstance) . void $
            insertContractInstance cmId addr chainId
          let default' = SVR.decodeValues 0 (typeDefs cont) (mainStruct cont) (const 0) 0
              cState = getContractState g addr chainId
          oldState <- fromMaybe default' <$> cState
          let newState = SVR.decodeCacheValues
                          (typeDefs cont)
                          (mainStruct cont)
                          cache
                          0
                          oldState
          setContractState g addr chainId newState
          let indexContract = processedContract strAbi strName chain (Map.fromList $ newState) row

          hist <- isHistoric g $ actionCodeHash row
          (hs,fhs) <- unzip <$> if hist
            then accumStateT oldState actions $ \hRow -> do
              let hCache = flip Map.lookup . todoToMap $ actionStorage hRow
              modify $ SVR.decodeCacheValues
                       (typeDefs cont)
                       (mainStruct cont)
                       hCache
                       0
              newMap <- gets Map.fromList
              let hInsert = processedContract strAbi strName chain newMap hRow
              functionHist <- isFunctionHistoric g $ actionCodeHash hRow
              fInserts <- if functionHist
                            then lift $ makeFunctionInserts
                                          (contractdetailsXabi details)
                                          strAbi
                                          strName
                                          chain
                                          newMap
                                          hRow
                            else pure []
              pure (hInsert, fInserts)
            else pure []
          pure . Right . BatchedInserts indexContract hs $ join fhs

  forM_ (lefts inserts) $ errorM "processTheMessages" . T.unpack

  let insertsByCodeHash = map snd . partitionWith (codehash . indexInsert) $ rights inserts
  forM_ insertsByCodeHash $ \ins -> do
    outputData conn . createInsertIndexTable g $ map indexInsert ins
    outputData conn . createInsertHistoryTable g . join $ map historyInserts ins
    outputData conn . createInsertFunctionHistoryTable g . join $ map functionInserts ins
