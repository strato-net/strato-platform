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

import Control.Arrow ((&&&))
import Control.Monad.Except
import Control.Monad.Log    hiding (Handler)
import Control.Monad.Reader
import qualified Data.Aeson as JSON
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy as BL
import Data.Either (lefts,rights)
import Data.IORef
import Data.Function
import Data.Map (Map)
import qualified Data.Map as Map
import Data.Monoid ((<>))
import Data.Pool
import Data.Maybe
import qualified Data.Text as T
import Data.Traversable (for)
import Data.Text.Encoding (decodeUtf8)
import Database.PostgreSQL.Simple
import Database.PostgreSQL.Typed
import Network.HTTP.Client
import Numeric
import Servant.Common.BaseUrl
import System.Log.Logger
import Data.LargeWord (Word256)

import BlockApps.Bloc22.Database.Queries
import BlockApps.Bloc22.Monad
import BlockApps.Ethereum
import BlockApps.Solidity.Contract
import BlockApps.Solidity.Xabi
import BlockApps.Strato.Client
import qualified BlockApps.Strato.Types as BA
import BlockApps.XAbiConverter
import BlockApps.SolidityVarReader

import Slipstream.Data.Action
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

hasContract::Action->Bool
hasContract = (/= emptyHash) . actionCodeHash

storageToList :: BA.Storage -> (Hex Word256, Hex Word256)
storageToList BA.Storage {BA.storageKey=k, BA.storageValue=v} = (k, v)

addStorageIfNeeded::Action -> Bloc (Map (Hex Word256) (Hex Word256))
addStorageIfNeeded Action{..} | actionType /= Update = return $ fromMaybe Map.empty actionStorage
                              | otherwise = do
  storage' <- blocStrato $ getStorage storageFilterParams { qsAddress = Just actionAddress
                                                          , qsChainId = actionTxChainId
                                                          }
  return . Map.fromList $ map storageToList storage'

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

withNothing :: Applicative f => Maybe a -> f (Maybe a) -> f (Maybe a)
withNothing m f = maybe f (pure . Just) m

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
      processedList <- forM change $ \row@Action{..} -> do
        liftIO . infoM "processTheMessages" . show $ T.concat ["--------\n", formatAction row]

        let md = fromMaybe Map.empty actionMetadata
        mcd <- getContractDetailsByCodeHash actionCodeHash
        mDetails <- withNothing mcd $ do
          fmap join . for (Map.lookup "src" md) $ \src -> do
            detailsMap <- compileContract src
            fmap join . for (Map.lookup "name" md) $ \name -> do
              traverse (pure . snd) $ Map.lookup name detailsMap

        if isNothing mDetails
          then return . Left $ "No details found for code hash "
                            <> (T.pack $ show actionCodeHash)
                            <> " and no 'src' field found in actionMetadata"
          else do
            let Just details = mDetails
                strAbi = T.replace "\'" "\'\'" . decodeUtf8 . BL.toStrict . JSON.encode $ contractdetailsXabi details
                strName = T.replace "\"" "" $ contractdetailsName details
                cont = either error id . xAbiToContract $ contractdetailsXabi details
                chain = maybe "" (T.pack . flip showHex "" . unChainId) actionTxChainId
                cache = maybe (const Nothing) (\s -> fmap unHex . flip Map.lookup s . Hex) actionStorage
            fetchLimit <- asks stateFetchLimit
            oldState <- fromMaybe (decodeValues fetchLimit (typeDefs cont) (mainStruct cont) (const 0) 0)
                          <$> getContractState g actionAddress actionTxChainId
            let newState = decodeCacheValues (typeDefs cont) (mainStruct cont) cache 0 oldState
                ret = Map.fromList newState
            setContractState g actionAddress actionTxChainId newState

            pure . Right . Just $ ProcessedContract
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
      when (not $ null processedList) . liftIO $ convertRet (catMaybes $ rights processedList) conn g
