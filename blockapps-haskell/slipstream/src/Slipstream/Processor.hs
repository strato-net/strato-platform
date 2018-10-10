{-# LANGUAGE
      OverloadedStrings
    , RecordWildCards
    , DeriveGeneric
    , QuasiQuotes
    , ScopedTypeVariables
    , DataKinds
    , TemplateHaskell
    , FlexibleContexts
    , GeneralizedNewtypeDeriving
#-}

module Slipstream.Processor where

import Control.Monad.Except
import Control.Monad.Log    hiding (Handler)
import Control.Monad.Reader
import qualified Data.Aeson as JSON
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.Either (lefts,rights)
import Data.IORef
import Data.Foldable
import Data.Function
import Data.Map (Map)
import qualified Data.Map as Map
import Data.Monoid ((<>))
import Data.Pool
import Data.Maybe
import Data.Text (Text)
import qualified Data.Text as T
import Data.Text.Encoding (decodeUtf8)
import Data.Traversable (for)
import Database.PostgreSQL.Simple
import Database.PostgreSQL.Typed
import Network.HTTP.Client
import Numeric
import Servant.Common.BaseUrl
import System.Log.Logger
import Data.LargeWord (Word256)

import BlockApps.Bloc22.API.Utils
import BlockApps.Bloc22.Database.Queries
import BlockApps.Bloc22.Monad
import BlockApps.Ethereum
import BlockApps.Solidity.Contract
import BlockApps.Solidity.Xabi
import BlockApps.Storage
import BlockApps.Strato.Client
import qualified BlockApps.Strato.Types as BA
import BlockApps.XAbiConverter
import BlockApps.SolidityVarReader

import Slipstream.Data.Action hiding (SourcePtr(..))
import qualified Slipstream.Data.Action as A (SourcePtr(..))
import Slipstream.Events
import Slipstream.Globals
import Slipstream.Options
import Slipstream.OutputData

toAction :: BL.ByteString -> Action
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

getContract :: Text -> Keccak256 -> Maybe ChainId -> Bloc (Either Text ContractAndXabi)
getContract name hash chainId = do
  if(hash == emptyHash)
    then return $ (Left "getContract called for an external account")
    else do
      xabi <- getContractXabi (ContractName name) (Named name) chainId

      return $ Right ContractAndXabi {
        contract = xAbiToContract xabi
        , xabi = decodeUtf8 . BL.toStrict $ JSON.encode xabi
        , name = name
        , contractStored = False
        , contractSchema = Nothing
        }

getContractCompileFullSource :: Address -> Keccak256 -> Maybe ChainId->Bloc (Either Text ContractAndXabi)
getContractCompileFullSource address hash chainId = do
  if (hash == emptyHash)
    then return $ (Left "getContractCompileFullSource called for an external account")
    else do
      contractDetails <- getContractDetailsByAddressOnly address chainId

      let ret = ContractAndXabi {
        contract = xAbiToContract $ contractdetailsXabi contractDetails
        , xabi = T.pack . show . JSON.toJSON $ contractdetailsXabi contractDetails
        , name = T.replace "\"" "" $ contractdetailsName contractDetails
        , contractStored = False
        , contractSchema = Nothing
      }
      return $ Right ret

storageToFunction :: Map (Hex Word256) (Hex Word256) -> Storage
storageToFunction s k = maybe 0 unHex . Map.lookup k $ Map.mapKeys unHex s

hasContract::Action->Bool
hasContract = (/= emptyHash) . actionCodeHash

storageToList :: BA.Storage -> (Hex Word256, Hex Word256)
storageToList BA.Storage {BA.storageKey=k, BA.storageValue=v} = (k, v)

addStorageIfNeeded::Action->Bloc Action
addStorageIfNeeded action'@Action{..} | actionType == Update = do
  storage' <- blocStrato $ getStorage storageFilterParams{ qsAddress = Just . Address . fst . head . readHex $ show actionAddress
                                                         , qsChainId = actionTxChainId
                                                         }
  return $ action'{actionStorage = Just . Map.fromList $ map storageToList storage'}
addStorageIfNeeded action = return action

isSameCreateAs :: Action -> Action -> Bool
isSameCreateAs x y = (((&&) `on` ((== Create) . actionType)) x y) && (((==) `on` actionCodeHash) x y)

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

processTheMessages :: [B.ByteString] -> PGConnection -> IORef Globals -> IO ()
processTheMessages messages conn g = do

  let changes = groupSimilarActions $ map (toAction . BL.fromStrict) messages

  unless (null messages) $
    debugM "processTheMessages" . unlines . map show $ messages

  case length messages of
   0 -> return ()
   1 -> infoM "processTheMessages" "1 message has arrived"
   n -> infoM "processTheMessages" $ show n ++ " messages have arrived"

  let conHost = flags_pghost
  let conPort = read flags_pgport
  let conUser = flags_pguser
  let conPass = flags_password
  let conDB = flags_database

  let dbConnectInfo = ConnectInfo { connectHost = conHost
                                 , connectPort = conPort
                                 , connectUser = conUser
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

  let env = BlocEnv
            {
              urlStrato=stratoUrl   -- :: BaseUrl
            , urlVaultWrapper = vaultwrapperUrl
            , httpManager=mgr -- :: Manager
            , dbPool=pool     --  :: Pool Connection
            , logLevel=Error
            , deployMode= deployFlag   -- :: Severity
            , stateFetchLimit = flags_stateFetchLimit
            }

  enterBloc2 env $ do
    forM_ (map (filter hasContract) changes) $ \change -> do
      processedList <- forM change $ \row -> do
        liftIO . infoM "processTheMessages" . show $ T.concat ["--------\n", formatAction row]
        Action{..} <- addStorageIfNeeded row

        sourcePtr' <-
          case actionSourcePtr of
            Just x -> do
              storeCachedSourcePtr g actionCodeHash x
              return actionSourcePtr
            Nothing -> do
              getCachedSourcePtr g actionCodeHash

        maybeCachedContract <- getCachedContract g actionCodeHash
        sourceIsCreated <- maybe (return False) (isSourceCreated g . A.sourceHash) sourcePtr'

        eContractMetadata <-
          case (sourceIsCreated, maybeCachedContract) of
           (_, Just cachedContract) -> pure $ Right cachedContract
           (True, Nothing) -> do
             let contName = maybe (error "name missing from sourcePtr") A.contractName sourcePtr'
             contractOrError <- getContract contName actionCodeHash actionTxChainId
                                  `catchError` (\_ -> return . Left $ "Error getting contract metadata for " <> contName)
             for contractOrError $ \c -> do
               storeCachedContract g actionCodeHash c
               pure c
           (False, Nothing) -> do
             liftIO . warningM "processTheMessages" . show $ T.concat
               [ "Need to call getContractCompileFullSource (this can be slow): ch:"
               , tshow actionCodeHash
               , ", src:"
               , tshow sourcePtr'
               ]
             contractOrError <- getContractCompileFullSource actionAddress actionCodeHash actionTxChainId
             traverse_ (setSourceCreated g . A.sourceHash ) sourcePtr'
             liftIO . infoM "processTheMessages" . show $ T.concat ["Done fetching the metadata for ", tshow actionCodeHash]
             for contractOrError $ \c -> do
               storeCachedContract g actionCodeHash c
               pure c

        for eContractMetadata $ \contractMetaData -> do
          let strAbi = T.replace "\'" "\'\'" . xabi $ contractMetaData
              strName = T.replace "\"" "" . name $ contractMetaData
              cont = case contract contractMetaData of
                      Left s -> error s
                      Right c -> c

              --TODO: Add parsing of contract info to get flags (indexing, history)

          fetchLimit <- asks stateFetchLimit
          let ret = Map.fromList $ decodeValues fetchLimit (typeDefs cont) (mainStruct cont) (storageToFunction $ fromMaybe (error "can't handle the case where we need to fetch the state") actionStorage) 0
          let chain = case actionTxChainId of
                      Nothing -> ""
                      Just (ChainId x) -> T.pack $ showHex x ""
          pure ProcessedContract
            { address = actionAddress
            , codehash = actionCodeHash
            , abi = strAbi
            , contractName = strName
            , chain = chain
            , contractData = ret
            , blockHash = actionBlockHash
            , blockTimestamp = actionBlockTimestamp
            , blockNumber = actionBlockNumber
            , transactionHash = actionTxHash
            , transactionSender = actionTxSender
            }

      forM_ (lefts processedList) $ liftIO . errorM "processTheMessages" . T.unpack
      when (not $ null processedList) . liftIO $ convertRet (rights processedList) conn g
