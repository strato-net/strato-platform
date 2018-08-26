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
import qualified Data.Aeson as JSON
import qualified Data.ByteString as B
import Database.PostgreSQL.Typed

import Slipstream.Data.Action (Action)
import qualified Slipstream.Data.Action as A
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
              chainId=chainId,
              storage=Just $ map (fmap newValue) $ Map.toList $ storage y
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

emptyHash :: String
emptyHash = "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"

getContract::String->String->Maybe ChainId->Bloc (Either String ContractAndXabi)
getContract _ "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470" _ = return $ (Left "Blank")
getContract address _ chainId = do
  qqqq <-
    getContractDetailsByAddressOnly (Address . fst . head $ readHex address) chainId

  let ret = ContractAndXabi {
    contract = xAbiToContract $ contractdetailsXabi qqqq
    , xabi = show $ JSON.toJSON $ contractdetailsXabi qqqq
    , name = show $ contractdetailsName qqqq
    , contractStored = False
  }
  return $ (Right ret)

storageToFunction::[(String, String)]->Storage
storageToFunction s k =
  case Map.lookup k (Map.fromList $ map (\(x, y) -> (fromInteger $ fst $ head $ readHex x, fromInteger $ fst $ head $ readHex y)) s) of
   Nothing -> 0
   Just x -> x

hasContract::Action->Bool
hasContract A.Action{A.codeHash="c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"} = False
hasContract _ = True

storageToList::BA.Storage->(String, String)
storageToList BA.Storage {BA.storageKey=k, BA.storageValue=v} = (show k, show v)

addStorageIfNeeded::Action->Bloc Action
addStorageIfNeeded action'@A.Action{..} | storage == Nothing= do
  storage' <- blocStrato $ getStorage storageFilterParams{ qsAddress = Just $ Address $ fst $ head $ readHex address }
  return $ action'{A.storage = Just $ map storageToList storage'}
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

processTheMessages :: [B.ByteString] -> PGConnection -> IORef (Map String ContractAndXabi) -> IO ()
processTheMessages messages conn cachedContractsIORef = do
  putStrLn $ show (length messages) ++ " messages have arrived"
  putStrLn $ unlines $ map show messages
  let tempChanges = map (toStateDiff . BL.fromStrict) messages
  let inter = smashIt tempChanges [] []
  let changes = map (concat . map stateDiffToChanges) inter
  
  putStrLn $ unlines $ map show changes


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
            }

  _ <- enterBloc2 env $ do
    forM (map (filter hasContract) changes) $ \change -> do
      processedList <- forM change $ \row -> do
            filledInChange <- addStorageIfNeeded row

            let (address, codehash, storage, chainId) =
                  case filledInChange of
                   A.Action {
                     A.address=a,
                     A.codeHash=c,
                     A.chainId=chId,
                     A.storage=Just s
                     } -> (a, c, storageToFunction s, chId)
                   _ -> error "can't handle the case where we need to fetch the state"
            cachedContracts <- liftIO $ readIORef cachedContractsIORef::Bloc (Map String ContractAndXabi)
            contractMetaData <-
              case Map.lookup codehash cachedContracts of
               Just c -> do
                 return c
               Nothing -> do
                 contractOrError <- getContract address codehash chainId
                 case contractOrError of
                  Left e -> error e
                  Right c -> do
                    liftIO $ writeIORef cachedContractsIORef (Map.insert codehash c cachedContracts)
                    return c

            let strAbi = replace "\'" "\'\'" $ xabi contractMetaData
            let strName = replace "\"" "" $ name contractMetaData
            let cont = case contract contractMetaData of
                    Left s -> error s
                    Right c -> c

            --TODO: Add parsing of contract info to get flags (indexing, history)

            let ret = Map.fromList $ decodeValues (typeDefs cont) (mainStruct cont) storage 0
            let chain = case chainId of
                          Nothing -> ""
                          Just(x) -> show x
            return ProcessedContract{address = address, codehash = codehash, abi = strAbi, contractName = strName, chain = chain, contractData = ret}

      if (length processedList > 0) then liftIO $ convertRet processedList conn cachedContractsIORef else return()

  return()
