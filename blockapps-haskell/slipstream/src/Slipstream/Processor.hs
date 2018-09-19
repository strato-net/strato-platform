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
import Data.IORef
import Data.Foldable
import Data.Map (Map)
import qualified Data.Map as Map
import Data.Pool
import Data.Maybe
import Data.Text (Text)
import qualified Data.Text as T
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

import Slipstream.Data.Action (Action)
import qualified Slipstream.Data.Action as A
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
emptyHash = keccak256 "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"

getContract :: Text -> Keccak256 -> Maybe ChainId -> Bloc (Either String ContractAndXabi)
getContract name hash chainId = do
  if(hash == emptyHash)
    then return $ (Left "noncontract accounts should have empty statediffs")
    else do
      xabi <- getContractXabi (ContractName name) (Named name) chainId

      return $ Right ContractAndXabi {
        contract = xAbiToContract xabi
        , xabi = T.pack . show $ JSON.toJSON xabi
        , name = name
        , contractStored = False
        , contractSchema = Nothing
        }

getContractCompileFullSource :: Address -> Keccak256 -> Maybe ChainId->Bloc (Either String ContractAndXabi)
getContractCompileFullSource address hash chainId = do
  if (hash == emptyHash)
    then return $ (Left "noncontract accounts should have empty statediffs")
    else do
      contractDetails <- getContractDetailsByAddressOnly address chainId

      let ret = ContractAndXabi {
        contract = xAbiToContract $ contractdetailsXabi contractDetails
        , xabi = T.pack . show . JSON.toJSON $ contractdetailsXabi contractDetails
        , name = T.replace "\"" "" $ contractdetailsName contractDetails
        , contractStored = False
        , contractSchema = Nothing
      }
      return $ (Right ret)

storageToFunction :: Map (Hex Word256) (Hex Word256) -> Storage
storageToFunction s k =
  case Map.lookup k (Map.mapKeys unHex s)  of
   Nothing -> 0
   Just x -> unHex x

hasContract::Action->Bool
hasContract action =
  if (A.actionCodeHash action == emptyHash)
    then False
    else True

storageToList :: BA.Storage -> (Hex Word256, Hex Word256)
storageToList BA.Storage {BA.storageKey=k, BA.storageValue=v} = (k, v)

addStorageIfNeeded::Action->Bloc Action
addStorageIfNeeded action'@A.Action{..} | actionType == A.Update = do
  storage' <- blocStrato $ getStorage storageFilterParams{ qsAddress = Just . Address . fst . head . readHex $ show actionAddress }
  return $ action'{A.actionStorage = Just . Map.fromList $ map storageToList storage'}
addStorageIfNeeded action = return action

matchAction :: A.Action -> A.Action -> Bool
matchAction (A.Action (A.Create) _ _ _ _ _ _ _ x _ _) (A.Action (A.Create) _ _ _ _ _ _ _ y _ _) = x == y
matchAction (A.Action _ _ _ _ _ _ _ _ _ _ _) (A.Action _ _ _ _ _ _ _ _ _ _ _) = False

smashIt :: [Action] -> [Action] -> [[Action]] -> [[Action]]
smashIt [] _ final = final
smashIt (x:y:rest) tmp final = do
  let newTmp = if (length tmp == 0)
      then [x]
      else tmp ++ [x]
  case (matchAction x y) of
    True -> smashIt ([y] ++ rest) newTmp final
    False -> smashIt ([y] ++ rest) [] (final ++ [newTmp])
smashIt (x:[]) tmp final =
  if (null tmp)
    then (final ++ [[x]])
    else final ++ [tmp ++ [x]]

processTheMessages :: [B.ByteString] -> PGConnection -> IORef Globals -> IO ()
processTheMessages messages conn g = do

  let tempChanges = map (toAction . BL.fromStrict) messages
  let changes = smashIt tempChanges [] []

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
            , deployMode= deployFlag
            }

  _ <- enterBloc2 env $ do
    forM (map (filter hasContract) changes) $ \change -> do
      processedList <- forM change $ \row -> do
        liftIO . infoM "processTheMessages" . show $ T.concat ["--------\n", A.formatAction row]
        A.Action{..} <- addStorageIfNeeded row

        sourcePtr' <-
          case actionSourcePtr of
            Just x -> do
              storeCachedSourcePtr g actionCodeHash x
              return actionSourcePtr
            Nothing -> do
              getCachedSourcePtr g actionCodeHash

        maybeCachedContract <- getCachedContract g actionCodeHash
        sourceIsCreated <- maybe (return False) (isSourceCreated g . A.sourceHash) sourcePtr'
        let addr = Address . fst . head . readHex $ show actionAddress

        contractMetaData <-
              case (sourceIsCreated, maybeCachedContract) of
               (_, Just cachedContract) -> return cachedContract
               (True, Nothing) -> do
                 let contName = maybe (error "name missing from sourcePtr") A.contractName sourcePtr'
                 contractOrError <- getContract contName actionCodeHash actionTxChainId
                 case contractOrError of
                  Left e -> error e
                  Right c -> do
                    storeCachedContract g actionCodeHash c
                    return c
               (False, Nothing) -> do
                 liftIO . warningM "processTheMessages" . show $ T.concat
                   [ "Need to call getContractCompileFullSource (this can be slow): ch:"
                   , tshow actionCodeHash
                   , ", src:"
                   , tshow sourcePtr'
                   ]
                 contractOrError <- getContractCompileFullSource addr actionCodeHash actionTxChainId
                 traverse_ (setSourceCreated g . A.sourceHash ) sourcePtr'
                 liftIO . infoM "processTheMessages" . show $ T.concat ["Done fetching the metadata for ", tshow actionCodeHash]
                 case contractOrError of
                  Left e -> error e
                  Right c -> do
                    storeCachedContract g actionCodeHash c
                    return c


        let strAbi = T.replace "\'" "\'\'" . xabi $ contractMetaData
            strName = T.replace "\"" "" . name $ contractMetaData
            cont = case contract contractMetaData of
                    Left s -> error s
                    Right c -> c

            --TODO: Add parsing of contract info to get flags (indexing, history)

        let ret = Map.fromList $ decodeValues (typeDefs cont) (mainStruct cont) (storageToFunction $ fromMaybe (error "can't handle the case where we need to fetch the state") actionStorage) 0
        let chain = case actionTxChainId of
                     Nothing -> ""
                     Just (ChainId x) -> T.pack $ showHex x ""
        return ProcessedContract{address = actionAddress,
                                 codehash = actionCodeHash,
                                 abi = strAbi,
                                 contractName = strName,
                                 chain = chain,
                                 contractData = ret,
                                 blockHash = actionBlockHash,          -- Keccak256
                                 blockTimestamp = actionBlockTimestamp,     -- UTCTime
                                 blockNumber = actionBlockNumber,        -- Integer
                                 transactionHash = actionTxHash,    -- Keccak256
                                 transactionSender = actionTxSender  -- Address
                               }

      if (length processedList > 0) then liftIO $ convertRet processedList conn g else return()

  return()
