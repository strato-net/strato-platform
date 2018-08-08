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

--data Action = Action ActionType String String (Maybe [(String, String)])
data Action = Action ActionType String String (Maybe ChainId) (Maybe [(String, String)])
              deriving (Show)
{-
stateDiffToChanges::StateDiff->[Action]
stateDiffToChanges StateDiff{..} =
  (map (\(x, y) -> Action Create x (codeHash y) (Just $ map (fmap newValue) $ Map.toList $ storage y)) $ maybe [] Map.toList $ createdAccounts)
  ++ (map (\(x, y) -> Action Delete x (codeHash y) Nothing) $ maybe [] Map.toList deletedAccounts)
  ++ (map (\(x, y) -> Action Update x (codeHash y) Nothing) $ maybe [] Map.toList updatedAccounts)
  where
    newValue (Diff _ x) = x
-}
stateDiffToChanges::StateDiff->[Action]
stateDiffToChanges StateDiff{..} =
  (map (\(x, y) -> Action Create x (codeHash y) chainId (Just $ map (fmap newValue) $ Map.toList $ storage y)) $ maybe [] Map.toList $ createdAccounts)
  ++ (map (\(x, y) -> Action Delete x (codeHash y) chainId Nothing) $ maybe [] Map.toList deletedAccounts)
  ++ (map (\(x, y) -> Action Update x (codeHash y) chainId Nothing) $ maybe [] Map.toList updatedAccounts)
  where
    newValue (Diff _ x) = x

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

data ContractAndXabi =
  ContractAndXabi {
    contract :: Either String Contract,
    xabi :: String,
    name :: String
  }
  deriving(Show)

getContract::String->String->Maybe ChainId->Bloc (Either String ContractAndXabi)
--getContract _ "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470" _ = return $ (Left "Blank contract", "Blank ABI", "Blank")
getContract _ "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470" _ = return $ (Left "Blank")
getContract address _ chainId = do
  qqqq <-
    getContractDetailsByAddressOnly (Address . fst . head $ readHex address) chainId

  --let ret1 = xAbiToContract $ contractdetailsXabi qqqq
  --liftIO $ putStrLn $ "ret1: " ++ show ret1
  --let ret2 = show $ A.toJSON $ contractdetailsXabi qqqq
  --liftIO $ putStrLn $ "ret2: " ++ show ret2
  --let ret3 = show $ contractdetailsName qqqq
  --liftIO $ putStrLn $ "ret3" ++ show ret3

  let ret = ContractAndXabi {
    contract = xAbiToContract $ contractdetailsXabi qqqq
    , xabi = show $ A.toJSON $ contractdetailsXabi qqqq
    , name = show $ contractdetailsName qqqq
  }
  return $ (Right ret)

-- fetchABI :: String -> Bloc String
-- fetchABI address = do
--   conDet <- getContractDetailsByAddressOnly (Address $ fst $ head $ readHex address)
--   let ret = show $ A.toJSON $ contractdetailsXabi conDet
--   return ret

storageToFunction::[(String, String)]->Storage
storageToFunction s k =
  case Map.lookup k (Map.fromList $ map (\(x, y) -> (fromInteger $ fst $ head $ readHex x, fromInteger $ fst $ head $ readHex y)) s) of
   Nothing -> 0
   Just x -> x

hasContract::Action->Bool
hasContract (Action _ _ "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470" _ _) = False
hasContract _ = True

storageToList::BA.Storage->(String, String)
storageToList BA.Storage {BA.storageKey=k, BA.storageValue=v} = (show k, show v)

addStorageIfNeeded::Action->Bloc Action
addStorageIfNeeded (Action theType address codehash chain Nothing)= do
  storage' <- blocStrato $ getStorage storageFilterParams{ qsAddress = Just $ Address $ fst $ head $ readHex address }
  return $ Action theType address codehash chain (Just $ map storageToList storage')
addStorageIfNeeded action = return action


resolveContractName :: Integer -> String -> String -> [(String, ContractAndXabi)] -> IO String
resolveContractName inc codehash contractName cache = do
  liftIO $ putStrLn $ "...contractName... " ++ show contractName
  liftIO $ putStrLn $ "...inc... " ++ show inc
  --let lst = Map.toList cache
  --liftIO $ putStrLn $ "...lst..." ++ show lst
  let nameList = map(\(_, y) -> (name y)) cache
  liftIO $ putStrLn $ ":::NAME LIST::: " ++ show nameList
  let sameName = filter (\(_, y) -> findName y) cache
  --liftIO $ putStrLn $ "___sameName___ " ++ show sameName
  if (null sameName)
    then
      if (inc == 0)
        then return contractName
        else do
          let newName = contractName ++ show inc
          return newName
    else do
      case (lookup codehash sameName) of
        Nothing -> do
          resolveContractName (inc + 1) codehash contractName cache
        Just _ -> do
          liftIO $ putStrLn "_=^SAME CODEHASH^=_"
          if (inc == 0)
            then return contractName
            else do
              let newName = contractName ++ show inc
              return newName
  where findName :: ContractAndXabi -> Bool
        findName cont = case inc of
          0 -> if(contractName == name cont)
            then True
            else False
          x -> if(contractName ++ show x == name cont)
            then True
            else False

processTheMessages :: [B.ByteString] -> IORef (Map String ContractAndXabi) -> IO ()
processTheMessages messages cachedContractsIORef = do
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

  let env = BlocEnv
            {
              urlStrato=stratoUrl   -- :: BaseUrl
            , httpManager=mgr -- :: Manager
            , dbPool=pool     --  :: Pool Connection
            , logLevel=Error
            , deployMode= deployFlag   -- :: Severity
            }

  --cachedContractsIORef <- newIORef Map.empty

  _ <- enterBloc2 env $ do
    liftIO $ putStrLn "{{{}}}"
    forM (filter hasContract changes) $ \change -> do

      --liftIO $ putStrLn $ "{{{CHANGE}}} : " ++ show change

      filledInChange <- addStorageIfNeeded change

      --liftIO $ putStrLn $ "{{{FILLED IN CHANGE}}} : " ++ show filledInChange

      --let (address, codehash, storage) =
      let (address, codehash, storage, chainId) =
            case filledInChange of
             --Action _ a c (Just s) -> (a, c, storageToFunction s)
             --Action _ _ _ _ -> error "can't handle the case where we need to fetch the state"
             Action _ a c chId (Just s) -> (a, c, storageToFunction s, chId)
             Action _ _ _ _ _ -> error "can't handle the case where we need to fetch the state"
      liftIO $ putStrLn $ "======address=====: " ++ show address
      liftIO $ putStrLn $ "======codehash=====: " ++ show codehash
      cachedContracts <- liftIO $ readIORef cachedContractsIORef::Bloc (Map String ContractAndXabi)
      contractMetaData <-
        case Map.lookup codehash cachedContracts of
         Just c -> do
           return c
         Nothing -> do
           --(contractOrError, abi, name) <- getContract address codehash chainId
           contractOrError <- getContract address codehash chainId
           case contractOrError of
            Left e -> error e
            Right c -> do
              --liftIO $ putStrLn $ "{{{c}}}"
              --Resolve Name Issues
              let contList = Map.toList cachedContracts
              resolvedName <- liftIO $ resolveContractName 0 codehash (name c) contList
              liftIO $ putStrLn $ "++++RESOLVEDNAME++++ " ++ show resolvedName
              let newContractAndXabi = ContractAndXabi{contract = contract c, xabi = (xabi c), name = resolvedName}
              liftIO $ writeIORef cachedContractsIORef (Map.insert codehash newContractAndXabi cachedContracts)
              return newContractAndXabi

      let strAbi = replace "\'" "\'\'" $ xabi contractMetaData
      let contName = replace "\"" "" $ name contractMetaData

      --TODO: Add parsing of contract info to get flags (indexing, history)
      let cont = case contract contractMetaData of
                    Left s -> error s
                    Right c -> c
      let ret = Map.fromList $ decodeValues (typeDefs cont) (mainStruct cont) storage 0
      let chain = case chainId of
                    Nothing -> ""
                    Just(x) -> show x
      --liftIO $ putStrLn $ "CHAIN ID: " ++ show chain

      liftIO $ convertRet address codehash strAbi contName chain ret

  return()
