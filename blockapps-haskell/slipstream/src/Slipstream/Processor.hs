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
import Data.Monoid ((<>))
import Data.Text (Text)
import qualified Data.Text as T
import Database.PostgreSQL.Simple
import Database.PostgreSQL.Typed
import Network.HTTP.Client
import Numeric
import Servant.Common.BaseUrl
import System.Log.Logger

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
import Slipstream.Events hiding (Address)
import Slipstream.Globals
import Slipstream.Options
import Slipstream.OutputData


stateDiffToChanges::StateDiff->[Action]
stateDiffToChanges StateDiff{..} =
  createAction A.Create createdAccounts
  ++ createAction A.Delete deletedAccounts
  ++ createAction A.Update updatedAccounts
  where
    newValue (Diff _ x) = x
    createAction action' =
      map (\(address', y) ->
            A.Action {
              actionType=action',
              address=address',
              codeHash=codeHash y,
              sourcePtr = uncurry A.SourcePtr <$> sourceCodeHash y,
              chainId=chainId,
              storage = Just . Map.map (fromMaybe "0" . newValue) $ storage y
              }
          ) . maybe [] Map.toList

toStateDiff::BL.ByteString->StateDiff
toStateDiff x =
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

emptyHash :: Text
emptyHash = "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"

getContract :: Text -> Text -> Maybe ChainId->Bloc (Either String ContractAndXabi)
getContract _ "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470" _ =
  return $ (Left "noncontract accounts should have empty statediffs")
getContract name _ chainId = do
  xabi <- getContractXabi (ContractName name) (Named name) chainId

  return $ Right ContractAndXabi {
    contract = xAbiToContract xabi
    , xabi = T.pack . show $ JSON.toJSON xabi
    , name = name
    , resolvedName = Nothing
    }

getContractCompileFullSource :: Address -> Text -> Maybe ChainId->Bloc (Either String ContractAndXabi)
getContractCompileFullSource _ "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470" _ =
  return $ (Left "noncontract accounts should have empty statediffs")
getContractCompileFullSource address _ chainId = do
  contractDetails <- getContractDetailsByAddressOnly address chainId

  let ret = ContractAndXabi {
    contract = xAbiToContract $ contractdetailsXabi contractDetails
    , xabi = T.pack . show . JSON.toJSON $ contractdetailsXabi contractDetails
    , name = contractdetailsName contractDetails
    , resolvedName = Nothing
    , contractStored = False
    , contractSchema = Nothing
  }
  return $ (Right ret)

storageToFunction :: Map Text Text -> Storage

fetchABI :: String -> Bloc String
fetchABI address = do
  conDet <- getContractDetailsByAddressOnly $ Address $ fst $ head $ readHex address
  let ret = show $ A.toJSON $ contractdetailsXabi conDet
  return ret

storageToFunction::[(String, String)]->Storage
>>>>>>> Resolve Names
storageToFunction s k =
  case Map.lookup k (Map.mapKeys read256 $ Map.map read256 s) of
   Nothing -> 0
   Just x -> x
  where read256 = fromInteger . fst . head . readHex . T.unpack

hasContract::Action->Bool
hasContract A.Action{A.codeHash="c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"} = False
hasContract _ = True

storageToList :: BA.Storage -> (Text, Text)
storageToList BA.Storage {BA.storageKey=k, BA.storageValue=v} = (T.pack $ show k, T.pack $ show v)

addStorageIfNeeded::Action->Bloc Action
addStorageIfNeeded action'@A.Action{..} | actionType == A.Update = do
  storage' <- blocStrato $ getStorage storageFilterParams{ qsAddress = Just . Address . fst . head . readHex $ T.unpack address }
  return $ action'{A.storage = Just . Map.fromList $ map storageToList storage'}
addStorageIfNeeded action = return action

matchStateDiff :: StateDiff -> StateDiff -> Bool
matchStateDiff (StateDiff (Just x) Nothing Nothing Nothing) (StateDiff (Just y) Nothing Nothing Nothing) = (codeHash $ head $ Map.elems x) == (codeHash $ head $ Map.elems y)
matchStateDiff (StateDiff _ _ _ _) (StateDiff _ _ _ _) = False

smashIt :: [StateDiff] -> [StateDiff] -> [[StateDiff]] -> [[StateDiff]]
smashIt [] _ final = final
smashIt (x:y:rest) tmp final = do
  let newTmp = if (length tmp == 0)
      then [x]
      else tmp ++ [x]
  case (matchStateDiff x y) of
    True -> smashIt ([y] ++ rest) newTmp final
    False -> smashIt ([y] ++ rest) [] (final ++ [newTmp])
smashIt (x:[]) tmp final =
  if (null tmp)
    then (final ++ [[x]])
    else final ++ [tmp ++ [x]]

resolveContractName :: Integer -> String -> String -> [(String, ContractAndXabi)] -> IO String
resolveContractName inc codehash contractName cache = do
  let sameName = filter (\(_, y) -> findName y) cache
  liftIO $ putStrLn $ "sameName: " ++ show sameName
  if (null sameName)
    then return $ contractName ++ show inc
    else do
      case (lookup codehash sameName) of
        Nothing -> do
          resolveContractName (inc + 1) codehash contractName cache
        Just _ -> do
          let newName = contractName ++ show inc
          return newName
  where findName :: ContractAndXabi -> Bool
        findName cont = do
          case resolvedName cont of
            Just x -> contractName ++ show inc == x
            --
            Nothing -> True

processTheMessages :: [B.ByteString] -> PGConnection -> IORef Globals -> IO ()
processTheMessages messages conn g = do
  let tempChanges = map (toStateDiff . BL.fromStrict) messages
  let inter = smashIt tempChanges [] []
  let changes = map (concat . map stateDiffToChanges) inter

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
        liftIO . infoM "processTheMessages" . show $ "--------\n" <> A.formatAction row
        A.Action{..} <- addStorageIfNeeded row

        sourcePtr' <-
          case sourcePtr of
            Just x -> do
              storeCachedSourcePtr g codeHash x
              return sourcePtr
            Nothing -> do
              getCachedSourcePtr g codeHash

        maybeCachedContract <- getCachedContract g codeHash
        sourceIsCreated <- maybe (return False) (isSourceCreated g . A.sourceHash) sourcePtr'
        let addr = Address . fst . head . readHex . T.unpack $ address

        contractMetaData <-
              case (sourceIsCreated, maybeCachedContract) of
               (_, Just cachedContract) -> return cachedContract
               (True, Nothing) -> do
                 let name = maybe (error "name missing from sourcePtr") A.contractName sourcePtr'
                 contractOrError <- getContract name codeHash chainId
                 case contractOrError of
                  Left e -> error e
                  Right c -> do
                    storeCachedContract g codeHash c
                    return c
               (False, Nothing) -> do
                 liftIO . warningM "processTheMessages" . show $ "Need to call getContractCompileFullSource (this can be slow): ch:" <>
                                     tshow codeHash <> ", addr:" <> tshow addr
                 contractOrError <- getContractCompileFullSource addr codeHash chainId
                 traverse_ (setSourceCreated g . A.sourceHash ) sourcePtr'
                 liftIO . infoM "processTheMessages" . show $ "Done fetching the metadata for " <> tshow codeHash
                 case contractOrError of
                  Left e -> error e
                  Right c -> do
                    --Resolve Name Issues
                    let contList = Map.toList cachedContracts
                    liftIO $ putStrLn $ "Pre-resolution name: " ++ show (replace "\"" "" $ name c)
                    resName <- liftIO $ resolveContractName 1 codehash (replace "\"" "" $ name c) contList
                    liftIO $ putStrLn $ "Resolved Name: " ++ show resName
                    let newContractAndXabi = ContractAndXabi{contract = contract c, xabi = (xabi c), name = name c, resolvedName = Just resName, contractStored = contractStored c, contractSchema = Nothing}
                    liftIO $ writeIORef cachedContractsIORef (Map.insert codehash newContractAndXabi cachedContracts)
                    return newContractAndXabi


        let strAbi = T.replace "\'" "\'\'" . xabi $ contractMetaData
            strName = T.replace "\"" "" . name $ contractMetaData
            cont = case contract contractMetaData of
                    Left s -> error s
                    Right c -> c

            --TODO: Add parsing of contract info to get flags (indexing, history)

        let ret = Map.fromList $ decodeValues (typeDefs cont) (mainStruct cont) (storageToFunction $ fromMaybe (error "can't handle the case where we need to fetch the state") storage) 0
        let chain = case chainId of
                     Nothing -> ""
                     Just (ChainId x) -> T.pack $ showHex x ""
        return ProcessedContract{address = address,
                                 codehash = codeHash,
                                 abi = strAbi,
                                 contractName = strName,
                                 chain = chain,
                                 contractData = ret}

      if (length processedList > 0) then liftIO $ convertRet processedList conn g else return()

  return()
