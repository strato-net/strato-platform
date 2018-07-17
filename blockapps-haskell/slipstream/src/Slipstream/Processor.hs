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
import qualified Data.ByteString.Lazy as BL
import Data.IORef
import Data.Map (Map)
import qualified Data.Map as Map
import Data.Pool
import Database.PostgreSQL.Simple
import Network.HTTP.Client
import Numeric
import Servant.Common.BaseUrl
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
import Slipstream.Events hiding (Address)
import Data.List.Utils (replace)
import qualified Data.Aeson as A
import qualified Data.ByteString as B
import HFlags
import Slipstream.Options

import Slipstream.OutputData

data ActionType = Create | Delete | Update deriving (Show)

data Action = Action ActionType String String (Maybe [(String, String)])
              deriving (Show)

stateDiffToChanges::StateDiff->[Action]
stateDiffToChanges StateDiff{..} =
  (map (\(x, y) -> Action Create x (codeHash y) (Just $ map (fmap newValue) $ Map.toList $ storage y)) $ maybe [] Map.toList $ createdAccounts)
  ++ (map (\(x, y) -> Action Delete x (codeHash y) Nothing) $ maybe [] Map.toList deletedAccounts)
  ++ (map (\(x, y) -> Action Update x (codeHash y) Nothing) $ maybe [] Map.toList updatedAccounts)
  where
    newValue (Diff _ x) = x
  {-
  (map (\(x, y) -> Action Create x (show $ codeHash y) (Just $ map (fmap newValue) $ Map.toList $ Map.mapKeys show $ storage y)) $ maybe [] Map.toList $ createdAccounts)
  ++ (map (\(x, y) -> Action Delete x (show $ codeHash y) Nothing) $ maybe [] Map.toList deletedAccounts)
  ++ (map (\(x, y) -> Action Update x (show $ codeHash y) Nothing) $ maybe [] Map.toList updatedAccounts)
  where
    newValue (Diff _ x) = show x
  -}

toStateDiff::BL.ByteString->StateDiff
toStateDiff x =
  case A.eitherDecode x of
    --Slipstream shouldn't crash here?
   Left e -> error $ show e
   --Right y -> traceShow(y) y
   Right y -> y

enterBloc2 :: BlocEnv -> Bloc x -> IO x
enterBloc2 env x = do
  ret <-
    runExceptT
    $ flip runLoggingT (filterPrintLog $ logLevel env)
    $ flip runReaderT env $ runBloc x

  case ret of
    --Slipstream shouldn't crash here?
   Left e -> error $ show e
   Right v -> return v

emptyHash :: String
emptyHash = "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"

getContract::String->String->Bloc (Either String Contract, String, String)
getContract _ "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470" = return $ (Left "Blank contract", "Blank ABI", "Blank")
getContract address _ = do
  qqqq <-
    getContractDetailsByAddressOnly $ Address $ fst $ head $ readHex address

  let ret1 = xAbiToContract $ contractdetailsXabi qqqq
  let ret2 = show $ A.toJSON $ contractdetailsXabi qqqq
  let ret3 = show $ contractdetailsName qqqq
  return (ret1, ret2, ret3)

fetchABI :: String -> Bloc String
fetchABI address = do
  conDet <- getContractDetailsByAddressOnly $ Address $ fst $ head $ readHex address
  let ret = show $ A.toJSON $ contractdetailsXabi conDet
  return ret

storageToFunction::[(String, String)]->Storage
storageToFunction s k =
  case Map.lookup k (Map.fromList $ map (\(x, y) -> (fromInteger $ fst $ head $ readHex x, fromInteger $ fst $ head $ readHex y)) s) of
   Nothing -> 0
   Just x -> x

hasContract::Action->Bool
hasContract (Action _ _ "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470" _) = False
hasContract _ = True

storageToList::BA.Storage->(String, String)
storageToList BA.Storage {BA.storageKey=k, BA.storageValue=v} = (show k, show v)

addStorageIfNeeded::Action->Bloc Action
addStorageIfNeeded (Action theType address codehash Nothing)= do
  storage' <- blocStrato $ getStorage storageFilterParams{ qsAddress = Just $ Address $ fst $ head $ readHex address }
  return $ Action theType address codehash (Just $ map storageToList storage')
addStorageIfNeeded action = return action

first :: (a, b, c) -> a
first (x, _, _) = x

second :: (a, b, c) -> b
second (_, x, _) = x

third :: (a, b, c) -> c
third (_, _, x) = x

processTheMessages :: [B.ByteString] -> IO ()
processTheMessages messages = do
  _ <- $initHFlags "Setup Slipstream Variables"
  let changes = concat $ map (stateDiffToChanges . toStateDiff . BL.fromStrict) messages
{-
  if (length changes > 0)
    then liftIO $ putStrLn $ "*****CHANGES*****: " ++ show changes
    else return ()
-}
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
  stratoUrl <- parseBaseUrl strato

  mgr <- newManager defaultManagerSettings

  --Set Flag on startup
  let deployFlag = BlockApps.Bloc22.Monad.Public

  cirrusUrl <- parseBaseUrl flags_cirrusurl

  let env = BlocEnv
            {
              urlStrato=stratoUrl   -- :: BaseUrl
            , urlCirrus= cirrusUrl
            , httpManager=mgr -- :: Manager
            , dbPool=pool     --  :: Pool Connection
            , logLevel=Error
            , deployMode= deployFlag   -- :: Severity
            }

  cachedContractsIORef <- newIORef Map.empty

  _ <- enterBloc2 env $ do
    forM (filter hasContract changes) $ \change -> do

--      liftIO $ convertRet address codehash strAbi $ encode $ parseChanges blocConn change

      filledInChange <- addStorageIfNeeded change

      let (address, codehash, storage) =
            case filledInChange of
             Action _ a c (Just s) -> (a, c, storageToFunction s)
             Action _ _ _ _ -> error "can't handle the case where we need to fetch the state"

      cachedContracts <- liftIO $ readIORef cachedContractsIORef::Bloc (Map String (Contract, String, String))
      contractMetaData <-
        case Map.lookup codehash cachedContracts of
         Just c -> do
           return c
         Nothing -> do
           (contractOrError, abi, name) <- getContract address codehash
           case contractOrError of
            Left e -> error e
            Right c -> do
              liftIO $ writeIORef cachedContractsIORef (Map.insert codehash (c, abi, name) cachedContracts)
              return (c, abi, name)

      let strAbi = replace "\'" "\'\'" $ second contractMetaData

      let name = replace "\"" "" $ third contractMetaData

      --liftIO $ putStrLn $ "~~~~~contractMetaData~~~~~: " ++ show contractMetaData

      --TODO: Add parsing of contract info to get flags (indexing, history)

      --let preSol = decodeValues (typeDefs $ first contractMetaData) (mainStruct $ first contractMetaData) storage 0
      --liftIO $ putStrLn $ "(((((((())))))))" ++ show preSol

      let ret = Map.fromList $ decodeValues (typeDefs $ first contractMetaData) (mainStruct $ first contractMetaData) storage 0

      --liftIO $ putStrLn $ "|..........| RET: " ++ show ret
      liftIO $ convertRet address codehash strAbi name ret

  return()
