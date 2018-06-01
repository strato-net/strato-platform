{-# LANGUAGE
      OverloadedStrings
    , RecordWildCards
    , DeriveGeneric
    , QuasiQuotes
    , ScopedTypeVariables
    , DataKinds
    , TemplateHaskell
    , FlexibleContexts
#-}

import           Control.Monad.Except
import           Control.Monad.Log                  hiding (Handler)
import           Control.Monad.Reader
import Data.Aeson hiding (Error)
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as BL
import qualified Data.ByteString.Lazy.Char8 as BLC
import qualified Data.ByteString.Base16 as B16
import Data.IORef
import Data.Map (Map)
import qualified Data.Map as Map
import Data.Pool
import           Database.PostgreSQL.Simple
import Network.HTTP.Client
import Numeric
import           Servant.Common.BaseUrl

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

import Events hiding (Address)

import Debug.Trace
import GHC.Generics
import Control.Exception
import GHC.Int

import qualified Data.Map as M
import qualified Data.HashMap.Strict as H
import qualified Data.Aeson as A
import qualified Data.ByteString as B
import qualified Data.Text as T
import Database.PostgreSQL.Typed
import Database.PostgreSQL.Typed.Query
import Network
import Network.Kafka
import Network.Kafka.Consumer
import qualified Network.Kafka.Protocol as K hiding (Message)
import Control.Monad.Trans.State.Lazy    (StateT(..))
import qualified Data.List.NonEmpty as NE
import Data.String
import Control.Lens


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


toStateDiff::BL.ByteString->StateDiff
toStateDiff x =
  case eitherDecode x of
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
   Left e -> error $ show e
   Right v -> return v

getContract::String->String->Bloc (Either String Contract)
getContract _ "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470" = return $ Left "Blank contract"
getContract address _ = do
  qqqq <-
    getContractDetailsByAddressOnly $ Address $ fst $ head $ readHex address

  return $ xAbiToContract $ contractdetailsXabi qqqq


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

prefix :: String -> String -> Bool
prefix [] ys = True
prefix (x:xs) [] = False
prefix (x:xs) (y:ys) = (x == y) && prefix xs ys

isString :: Value -> Bool
isString (String x) = not (prefix "function" (T.unpack x))
isString _ = True

listToKeyStatement :: String -> [(T.Text, b)] -> String
listToKeyStatement s [] = []
listToKeyStatement s [(x, y)] = T.unpack x
listToKeyStatement s ((x,y):es) = T.unpack x ++ s ++ (listToKeyStatement s es)

valueToString :: String -> Value -> String
valueToString s (String x) = s ++ T.unpack x ++ s
valueToString s (Number x) = s ++ show x ++ s
valueToString s (Array x) = "\'Array\'"

listToValueStatement :: String -> [(a, Value)] -> String
listToValueStatement s [] = []
listToValueStatement s [(x, y)] = valueToString "\'" y
listToValueStatement s ((x, y):es) = valueToString "\'" y ++ s ++ (listToValueStatement s es)

valueToText :: Value -> String
valueToText (Number y) = "bigint"
valueToText (_) = "text"

tableColumns :: [(T.Text, Value)] -> String
tableColumns [] = []
tableColumns [(x, y)] = T.unpack x ++ " " ++ valueToText y
tableColumns ((x, y):es) = T.unpack x ++ " " ++ valueToText y ++ ", " ++ tableColumns es

useTPGDatabase (defaultPGDatabase { pgDBName = "postgres", pgDBUser = "postgres", pgDBPass = "api" })

dbInsert :: String -> IO()
dbInsert insrt = do

  conn <- pgConnect PGDatabase
    { pgDBHost = "172.18.0.5"
    , pgDBPort =  PortNumber 5432
    , pgDBUser = "postgres"
    , pgDBPass = "api"
    , pgDBName = "postgres"
    , pgDBDebug = False
    , pgDBLogMessage = print . PGError
    , pgDBParams = [("Timezone", "UTC")]
    }

  let qry = rawPGSimpleQuery $ BC.pack insrt
  let testIns = pgRunQuery conn qry
  p <- testIns
  print p
  case p of
    (-1, _) -> putStrLn "Error writing to the database"
    (x, _) -> putStrLn "Successfully wrote to the database"

  pgDisconnect conn

convertRet :: String -> BLC.ByteString -> IO()
convertRet address x = do
  case decode x of
    Nothing -> putStrLn $ "Error"
    Just (Object x) -> do
      let list = H.toList $ H.filter isString x
      let contractName = "test"
      let createSt = "create table if not exists \"" ++ contractName ++ "\" (address text, " ++ tableColumns list ++ ")"
      let keys = "(" ++ listToKeyStatement ", " list ++ ")"
      let vals = "(" ++ listToValueStatement ", " list ++ ")"
      let keys = "(" ++ "address, " ++ listToKeyStatement ", " list ++ ")"
      let vals = "(" ++ "'" ++ address ++ "', "  ++ listToValueStatement ", " list ++ ")"
      let ins = "insert into \"" ++ contractName ++ "\" " ++ keys ++ " values " ++ vals
      p <- dbInsert createSt
      print p
      dbInsert ins
  -- case x of
  --  Left ex  -> return "Caught exception: " ++ show ex
    --Right val -> return "Result: " ++ show val
{-}
getContractName :: BLC.ByteString -> String
getContractName x =
  case decode x of
    Nothing -> "No contract information found"
    Just (Object y) -> do
      let list = H.toList y
      let mapVal = Map.lookup "name" y
      case mapVal of
        Nothing -> "No name found"
        Just z -> valueToString "" z
-}

data KafkaConf =
    KafkaConf {
        kafkaHost :: String,
        kafkaPort :: Int
    } deriving (Generic)

defaultKafkaConfig  ::  KafkaConf
defaultKafkaConfig = KafkaConf {
  kafkaHost = "kafka",
  kafkaPort = 9092
  }

instance FromJSON KafkaConf
instance ToJSON KafkaConf

makKafkaState :: KafkaClientId -> KafkaAddress -> KafkaState
makKafkaState cid addy =
    KafkaState cid
               defaultRequiredAcks
               defaultRequestTimeout
               defaultMinBytes
               defaultMaxBytes
               defaultMaxWaitTime
               defaultCorrelationId
               M.empty
               M.empty
               M.empty
               (addy NE.:| [])

mkConfiguredKafkaState :: KafkaClientId -> KafkaState
mkConfiguredKafkaState cid = makKafkaState cid (kh, kp)
    where k = defaultKafkaConfig --KafkaConf
          kh = fromString $ kafkaHost k
          kp = fromIntegral $ kafkaPort k

runKafkaConfigured :: KafkaClientId -> StateT KafkaState (ExceptT KafkaClientError IO) a -> IO (Either KafkaClientError a)
runKafkaConfigured name = runKafka (mkConfiguredKafkaState name)

setDefaultKafkaState :: Kafka k => k ()
setDefaultKafkaState = do
    stateRequiredAcks Control.Lens..= -1
    stateWaitSize     Control.Lens..= 1
    stateWaitTime     Control.Lens..= 100000

convertMsg :: Show a => Either KafkaClientError a -> [B.ByteString]
convertMsg x =
  case x of
    Left e -> error $ show e
    Right y -> return (BC.pack $ show y)


lookupTopic :: String -> K.TopicName
lookupTopic label = fromString "stateDiff"

getMessages :: IO[B.ByteString]
getMessages = do
  let offset = 0
  let kafkaID = "queryStrato" :: KafkaClientId
  let state = mkConfiguredKafkaState kafkaID

  msg <- runKafka state $ (doConsume offset)
  return $ convertMsg $ msg
    where
    doConsume :: Kafka a => K.Offset -> a [B.ByteString]
    doConsume offset = do
      let topic = lookupTopic "stateDiff"
      fetched <- fetch offset 0 topic
      let messages = (map tamPayload . fetchMessages) fetched
      rest <- doConsume (offset + fromIntegral (length messages))
      return $ messages ++ rest

main::IO ()
main = do
  --changes <- fmap (concat . map (stateDiffToChanges . toStateDiff . BL.fromStrict . fst . B16.decode) . BC.lines) BC.getContents
  changes <- (concat . map (stateDiffToChanges . toStateDiff . BL.fromStrict . fst . B16.decode)) Main.getMessages

  let dbConnectInfo = ConnectInfo { connectHost = "172.18.0.5"
                                 , connectPort = 5432
                                 , connectUser = "postgres"
                                 , connectPassword = "api"
                                 , connectDatabase = "postgres"
                                 }

  pool <- createPool (connect dbConnectInfo{connectDatabase="bloc22"}) close 5 3 5

  stratoUrl <- parseBaseUrl "172.18.0.8:3000/eth/v1.2/"
  mgr <- newManager defaultManagerSettings

  let env = BlocEnv
            {
              urlStrato=stratoUrl   -- :: BaseUrl
            , httpManager=mgr -- :: Manager
            , dbPool=pool     --  :: Pool Connection
            , logLevel=Error    -- :: Severity
            }


  cachedContractsIORef <- newIORef Map.empty


  _ <-
    enterBloc2 env $ do
      forM (filter hasContract changes) $ \change -> do
        filledInChange <- addStorageIfNeeded change

        let (address, codehash, storage) =
              case filledInChange of
               Action _ a c (Just s) -> (a, c, storageToFunction s)
               Action _ _ _ _ -> error "can't handle the case where we need to fetch the state"

        liftIO $ putStrLn $ "a = " ++ show address ++ " c = " ++ show codehash
        cachedContracts <- liftIO $ readIORef cachedContractsIORef::Bloc (Map String Contract)

        contractMetaData <-
          case Map.lookup codehash cachedContracts of
           Just c -> return c
           Nothing -> do
             contractOrError <- getContract address codehash
             case contractOrError of
              Left e -> error e
              Right c -> do
                liftIO $ writeIORef cachedContractsIORef (Map.insert codehash c cachedContracts)
                return c

        --let hexadd = readHex address
        --let addr = Address hexadd
        --let name = contractdetailsName <$>  getContractDetailsByAddressOnly addr

        let ret =
              Map.fromList $ map (fmap valueToSolidityValue) $
              decodeValues (typeDefs contractMetaData) (mainStruct contractMetaData) storage 0
        liftIO $ convertRet address $ encode ret

  return ()
