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
import Data.Int (Int32)
import Data.IORef
import Data.Foldable (for_)
import Data.Function
import Data.Functor.Identity (runIdentity)
import qualified Data.Map.Ordered as OMap
import qualified Data.Map as Map
import Data.Monoid ((<>))
import Data.Pool
import Data.Maybe
import qualified Data.Text as T
import Data.Traversable (for)
import Data.Text (Text)
import Data.Text.Encoding (decodeUtf8)
import Database.PostgreSQL.Simple
import Database.PostgreSQL.Typed
import Network.HTTP.Client
import Numeric
import Servant.Common.BaseUrl
import System.Log.Logger

import BlockApps.Bloc22.Database.Queries
import BlockApps.Bloc22.Monad
import BlockApps.Ethereum
import BlockApps.Solidity.Contract
import BlockApps.Solidity.Type
import BlockApps.Solidity.Struct
import BlockApps.Solidity.Value
import BlockApps.Solidity.Xabi
import BlockApps.XAbiConverter
import qualified BlockApps.SolidityVarReader as SVR

import Slipstream.Data.Action
import Slipstream.Events
import Slipstream.Globals
import Slipstream.Metrics
import Slipstream.Options
import Slipstream.OutputData
import Slipstream.SolidityValue

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
matters Action{..} = (actionType == Create) || (not . Map.null $ actionStorage)

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
    merge a b = b { actionStorage  = (Map.union `on` actionStorage) b a
                  , actionMetadata = (Map.union `on` actionMetadata) b a
                  }

accumStateT :: Monad m => s -> [a] -> (a -> StateT s m b) -> m [b]
accumStateT s as = fmap snd . scanStateT s as

buildStateT :: Monad m => s -> [a] -> (a -> StateT s m ()) -> m s
buildStateT s as = fmap fst . scanStateT s as

scanStateT :: Monad m => s -> [a] -> (a -> StateT s m b) -> m (s,[b])
scanStateT s [] _ = pure (s,[])
scanStateT s (a:as) run = do
  (b,s') <- runStateT (run a) s
  fmap (b:) <$> scanStateT s' as run

partitionWith :: Ord k => (a -> k) -> [a] -> [(k,[a])]
partitionWith f as = runIdentity $ fmap (map (fmap reverse) . Map.toList) . buildStateT Map.empty as $ \a -> do
  s <- get
  let k = f a
  case Map.lookup k s of
    Nothing -> put (Map.insert k [a] s)
    Just _  -> put (Map.update (Just . (a:)) k s)

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

getFunctionDetailsFromSelector :: Int32 -> ByteString -> Bloc (Text, ([(Text,Type)],[(Maybe Text, Type)]))
getFunctionDetailsFromSelector cmId sel' = do
  contract' <- getContractContractByMetadataId cmId
  return $ functionDetailsFromContract contract' sel'

convertEnumTypeToInt :: Type -> Type
convertEnumTypeToInt = \case
  TypeEnum _ -> SimpleType $ TypeInt False $ Just 32
  TypeArrayFixed n ty -> TypeArrayFixed n (convertEnumTypeToInt ty)
  TypeArrayDynamic ty -> TypeArrayDynamic (convertEnumTypeToInt ty)
  ty -> ty

convertByteStringToVals :: ByteString -> [Type] -> Maybe [SolidityValue]
convertByteStringToVals byteResp responseTypes = map valueToSolidityValue <$> bytestringToValues byteResp responseTypes

getFunctionCallValues :: Int32 -> ByteString -> ByteString -> Bloc (Text, [(Text, SolidityValue)], [(Text, SolidityValue)])
getFunctionCallValues cmId input' output' = do
  let sel = B.take 4 input'
      data' = B.drop 4 input'
  (fname,(itypes,otypes)) <- getFunctionDetailsFromSelector cmId sel
  let typemap bs = uncurry zip
                   . fmap ( fromMaybe (repeat (SolidityValueAsString ""))
                     . convertByteStringToVals bs
                     . map convertEnumTypeToInt
                   ) . unzip
      imap = typemap data' itypes
      omap = zipWith
               (\i (n,v) -> (fromMaybe (T.pack $ '#':show i) n, v))
               ([0..] :: [Integer])
               (typemap output' otypes)
  return (fname,imap,omap)

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

makeFunctionInserts :: Int32
                    -> Text
                    -> Text
                    -> Text
                    -> Map.Map Text Value
                    -> Action
                    -> Bloc [ProcessedContract]
makeFunctionInserts cmId abi name chain state Action{..} =
  forM actionCallData $ \CallData{..} -> do
    let ibytes = _input
        obytes = fromMaybe B.empty _output
    (f',i,o) <- getFunctionCallValues cmId ibytes obytes
    let f = if T.null f'
              then if actionType == Create
                    then "constructor"
                    else "fallback"
              else f'

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

processTheMessages :: [B.ByteString] -> PGConnection -> IORef Globals -> IO ()
processTheMessages messages conn g = do

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

  let conHost = flags_pghost
      conPort = fromIntegral flags_pgport
      conUser = flags_pguser
      conPass = flags_password
      conDB = flags_database
      dbConnectInfo = ConnectInfo
        { connectHost     = conHost
        , connectPort     = conPort
        , connectUser     = conUser
        , connectPassword = conPass
        , connectDatabase = conDB
        }

  pool <- createPool (connect dbConnectInfo{connectDatabase="bloc22"}) close 5 3 5
  let strato = flags_stratourl
      vaultWrapper = flags_vaultwrapperurl
  stratoUrl <- parseBaseUrl strato
  vaultwrapperUrl <- parseBaseUrl vaultWrapper

  mgr <- newManager defaultManagerSettings

  --Set Flag on startup
  let deployFlag = BlockApps.Bloc22.Monad.Public
      env = BlocEnv
            {
              urlStrato=stratoUrl   -- :: BaseUrl
            , urlVaultWrapper = vaultwrapperUrl
            , httpManager=mgr -- :: Manager
            , dbPool=pool     --  :: Pool Connection
            , logLevel=Error
            , deployMode= deployFlag   -- :: Severity
            , stateFetchLimit = 0 -- not relevant since
                                  -- Slipstream doesn't
                                  -- call /storage route
                                  -- anymore
            }

  enterBloc2 env . forM_ changes $ \((addr,chainId),actions) -> do
    let row = combineActions actions
    recordAction row
    liftIO . infoM "processTheMessages" . show $ T.concat ["--------\n", formatAction row]

    let md = actionMetadata row
    mcd <- getContractDetailsByCodeHash $ actionCodeHash row
    mDetails <- withNothing mcd $ do
      fmap join . for (Map.lookup "src" md) $ \src -> do
        detailsMap <- compileContract src
        fmap join . for (Map.lookup "name" md) $ \name -> do
          traverse pure $ Map.lookup name detailsMap

    if isNothing mDetails
      then liftIO . errorM "processTheMessages" . T.unpack
             $ "No details found for code hash "
             <> (T.pack . show $ actionCodeHash row)
             <> " and no 'src' field found in actionMetadata"
      else do
        let Just (cmId,details) = mDetails
            strAbi = T.replace "\'" "\'\'" . decodeUtf8 . BL.toStrict . JSON.encode $ contractdetailsXabi details
            strName = T.replace "\"" "" $ contractdetailsName details
            cont = either error id . xAbiToContract $ contractdetailsXabi details
            chain = maybe "" (T.pack . flip showHex "" . unChainId) $ actionTxChainId row
            cache = flip Map.lookup $ actionStorage row
            updateGlobal m (k,f) = for_ (Map.lookup k $ actionMetadata row) $ \v -> do
              let contracts = filter (not . T.null) $ T.splitOn "," v
              forM_ contracts $ \c -> for_ (fmap (contractdetailsCodeHash . snd) $ Map.lookup c m) $ f g

        detailsMap <- compileContract $ contractdetailsSrc details -- won't actually recompile the contract
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
        let indexContract = processedContract strAbi strName chain (Map.fromList newState) row
        outputData conn $ createInsertIndexTable g indexContract

        hist <- isHistoric g $ actionCodeHash row
        when hist $ do
          hContracts <- accumStateT oldState actions $ \hRow -> do
            st <- get
            let newSt = SVR.decodeCacheValues
                         (typeDefs cont)
                         (mainStruct cont)
                         cache
                         0
                         st
                newMap = Map.fromList newSt
            put newSt
            let hInsert = processedContract strAbi strName chain newMap hRow
            functionHist <- isFunctionHistoric g $ actionCodeHash hRow
            fInserts <- if functionHist
                          then lift $ makeFunctionInserts cmId strAbi strName chain newMap hRow
                          else pure []
            pure (hInsert, fInserts)
          outputData conn . createInsertHistoryTable g $ map fst hContracts
          outputData conn . createInsertFunctionHistoryTable g . join $ map snd hContracts
