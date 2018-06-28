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
import HFlags
import Options
import System.IO.Unsafe
import qualified Data.Vector as V
import Language.Haskell.TH.Syntax
import Language.Haskell.TH.Lib
import Data.List
import Data.Time


data ActionType = Create | Delete | Update deriving (Show)

data Action = Action ActionType String String (Maybe [(String, String)])
              deriving (Show)

stateDiffToChanges::StateDiff->[Action]
stateDiffToChanges StateDiff{..} =
  (map (\(x, y) -> Action Create x (codeHash y) (Just $ map (fmap newValue) $ Map.toList $ storage y)) $ maybe [] Map.toList $ createdAccounts)
  ++ (map (\(x, y) -> Action Delete x (codeHash y) Nothing) $ maybe [] Map.toList deletedAccounts)
  --Early stage of slipstream ommits updates
  ++ (map (\(x, y) -> Action Update x (codeHash y) Nothing) $ maybe [] Map.toList updatedAccounts)
  where
    newValue (Diff _ x) = x


toStateDiff::BL.ByteString->StateDiff
toStateDiff x =
  case eitherDecode x of
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

getContract::String->String->Bloc (Either String Contract, String)
getContract _ "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470" = return $ (Left "Blank contract", "Blank ABI")
getContract address _ = do
  qqqq <-
    getContractDetailsByAddressOnly $ Address $ fst $ head $ readHex address

  let ret2 = show $ toJSON $ contractdetailsXabi qqqq
  let ret1 = xAbiToContract $ contractdetailsXabi qqqq
  return (ret1, ret2)

fetchABI :: String -> Bloc String
fetchABI address = do
  conDet <- getContractDetailsByAddressOnly $ Address $ fst $ head $ readHex address
  let ret = show $ toJSON $ contractdetailsXabi conDet
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
{-
arrayToString :: [(T.Text, Value)] -> String
arrayToString [] = []
arrayToString [(x, y)] = case y of
  String val -> T.unpack x ++ ": " ++ T.unpack val
  val -> T.unpack x ++ ": " ++ show val
arrayToString ((x, y):es) = case y of
  String val -> T.unpack x ++ ": " ++ T.unpack val ++ ", " ++ arrayToString es
  val -> T.unpack x ++ ": " ++ show val ++ ", " ++ arrayToString es
-}
valueToString :: String -> Value -> String
valueToString s (String x) = s ++ T.unpack x ++ s
valueToString s (Number x) = s ++ show x ++ s
valueToString s (Array x) = s ++ (show $ V.toList x) ++ s

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
  let conHost = flags_pghost :: HostName
  --let conHost = "172.18.0.6" :: HostName
  let conPort = PortNumber $ read flags_pgport
  let conUser = BC.pack flags_pguser :: B.ByteString
  let conPass = BC.pack flags_password :: B.ByteString
  let conDB = BC.pack flags_database :: B.ByteString

  conn <- pgConnect PGDatabase
    { pgDBHost = conHost
    , pgDBPort = conPort
    , pgDBUser = conUser
    , pgDBPass = conPass
    , pgDBName = conDB
    , pgDBDebug = False
    , pgDBLogMessage = print . PGError
    , pgDBParams = [("Timezone", "UTC")]
    }

  let qry = rawPGSimpleQuery $ BC.pack insrt
  let ins = pgRunQuery conn qry
  p <- ins
  print p
  case p of
    (-1, _) -> putStrLn "Error writing to the database"
    (x, _) -> putStrLn "Successfully wrote to the database"

  pgDisconnect conn

convertRet :: String -> String -> String -> BLC.ByteString -> IO()
convertRet address codehash abi x = do
  case decode x of
    Nothing -> putStrLn $ "Error"
    Just (Object x) -> do
      -- Change contract name here
      let contractName = take 30 codehash
      let conVals = "('" ++ codehash ++ "', '" ++ contractName ++ "', '" ++ abi ++ "')"
      let conIns = "insert into contract (\"codeHash\", contract, abi) values " ++ conVals ++ ";"
      let list = H.toList $ H.filter isString x
      let beg = "BEGIN;"
      let comm = "COMMIT;"
      let createSt = "create table if not exists \"" ++ contractName ++ "\" (address text, " ++ tableColumns list ++ ");"
      let keys = "(" ++ "address, " ++ listToKeyStatement ", " list ++ ")"
      let vals = "(" ++ "'" ++ address ++ "', "  ++ listToValueStatement ", " list ++ ")"
      let ins = "insert into \"" ++ contractName ++ "\" " ++ keys ++ " values " ++ vals ++ ";"
      let oneIns = beg ++ conIns ++ createSt ++ ins ++ comm
      p <- dbInsert oneIns
      --print p

  -- case x of
  --  Left ex  -> return "Caught exception: " ++ show ex
    --Right val -> return "Result: " ++ show val

defaultMaxB :: K.MaxBytes
defaultMaxB = 32 * 1024 * 1024

data KafkaConf =
    KafkaConf {
        kafkaHost :: String,
        kafkaPort :: Int
    } deriving (Generic)

defaultKafkaConfig  ::  KafkaConf
defaultKafkaConfig = KafkaConf {
  kafkaHost = flags_kafkahost
  , kafkaPort = flags_kafkaport
  }

instance FromJSON KafkaConf
instance ToJSON KafkaConf

makeKafkaState :: KafkaClientId -> KafkaAddress -> KafkaState
makeKafkaState cid addy =
    KafkaState cid
               defaultRequiredAcks
               defaultRequestTimeout
               defaultMinBytes
               defaultMaxB
               defaultMaxWaitTime
               defaultCorrelationId
               M.empty
               M.empty
               M.empty
               (addy NE.:| [])

mkConfiguredKafkaState :: KafkaClientId -> KafkaState
mkConfiguredKafkaState cid = makeKafkaState cid (kh, kp)
    where k = defaultKafkaConfig --KafkaConf
          kh = fromString $ kafkaHost k
          kp = fromIntegral $ kafkaPort k

lookupTopic :: K.TopicName
lookupTopic = fromString "statediff"

processTheMessages :: [B.ByteString] -> IO ()
processTheMessages messages = do

  let changes = concat $ map (stateDiffToChanges . toStateDiff . BL.fromStrict) messages
  --changes <- fmap (concat . map (stateDiffToChanges . toStateDiff . BL.fromStrict . fst . B16.decode) . BC.lines) BC.getContents

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

        cachedContracts <- liftIO $ readIORef cachedContractsIORef::Bloc (Map String (Contract, String))

        contractMetaData <-
          case Map.lookup codehash cachedContracts of
           Just c -> do
             return c
           Nothing -> do
             (contractOrError, abi) <- getContract address codehash
             case contractOrError of
              Left e -> error e
              Right c -> do
                liftIO $ writeIORef cachedContractsIORef (Map.insert codehash (c, abi) cachedContracts)
                return (c, abi)

        let strAbi = snd contractMetaData

        let ret =
              Map.fromList $ map (fmap valueToSolidityValue) $
              decodeValues (typeDefs $ fst contractMetaData) (mainStruct $ fst contractMetaData) storage 0
        liftIO $ convertRet address codehash strAbi $ encode ret
  return()

getTheMessages :: Kafka a => K.Offset -> a [B.ByteString]
getTheMessages offset = do
  fetched <- fetch offset 0 lookupTopic
  let errorStatuses = concat $ map (^.. _2 . folded . _2) (fetched ^. K.fetchResponseFields)
  case find (/= K.NoError) errorStatuses of
   Just e -> error $ "There was a critical Kafka error while fetching messages: " ++ show e ++ "\ntopic = " ++ BC.unpack (lookupTopic ^. K.tName ^. K.kString) ++ ", offset = " ++ show offset
   _ -> return ()
  let ret = (map tamPayload . fetchMessages) fetched
  return ret

getAndProcessMessages :: Kafka a => K.Offset -> a ()
getAndProcessMessages offset = do
  messages <- getTheMessages offset
  liftIO $ processTheMessages messages
  getAndProcessMessages $ (offset + fromIntegral (length messages))

main::IO ()
main = do
  currentTime <- getCurrentTime
  liftIO $ putStrLn $ "Main -> " ++ show(currentTime)
  _ <- $initHFlags "Setup Slipstream Variables"

  let conCreate = "create table if not exists contract (id serial primary key, \"codeHash\" text, contract text, abi text)"
  dbInsert conCreate

  let offset = 0 :: K.Offset
  let kafkaID = "queryStrato" :: KafkaClientId
  let state = mkConfiguredKafkaState kafkaID

  msg <- runKafka state $ (getAndProcessMessages offset)
  messages <- case msg of
        Left e -> error $ show e
        Right y -> return y

  return ()
