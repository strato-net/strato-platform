{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DerivingStrategies #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

{-# OPTIONS -fno-warn-orphans #-}

module Main where

import Bloc.API
-- hiding (handleRuntimeError)
import Bloc.Monad
import Bloc.NonceStore (ensureNonceCounterTable)
import Bloc.Server
import BlockApps.Init
import BlockApps.Logging
import Blockchain.DB.CodeDB
import Blockchain.DB.SQLDB (CirrusDB, SQLDB)
import Blockchain.Data.AddressStateDB
import Blockchain.Data.AddressStateRef
import Blockchain.Data.Block (Block)
import Blockchain.Data.DataDefs
import Blockchain.EthConf
import qualified Blockchain.EthConf.Model as Conf
import Blockchain.Model.JsonBlock
import Blockchain.Data.NodeStatus (CirrusTip, getNodeBestBlock, getNodeBestSequencedBlock, getNodeCirrusTip, getNodeSyncStatus, getNodeWorldBestBlock)
import Blockchain.Model.SyncState (BestBlock, BestSequencedBlock, WorldBestBlock)
import Blockchain.Sequencer.Event (IngestEvent)
import Blockchain.Strato.Discovery.Data.PeerIOWiring ()
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import Blockchain.SyncDB (SyncStatus (..))
import Control.Lens.Operators
import Control.Monad.Change.Alter
import Control.Monad.Change.Modify
import Control.Monad.Composable.Base (AccessibleEnv, Eff, Logger, provide, runEff)
import Control.Monad.Composable.SQL
import Control.Monad.Trans.Except
import Control.Monad.Trans.Maybe
import Core.API
import Data.Aeson ()
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy.Char8 as BLC
import qualified Data.HashMap.Strict.InsOrd as H
import Data.Map (fromList, traverseWithKey)
import Data.Maybe (listToMaybe)
import Data.Source.Map
import Data.OpenApi hiding (Header, delete)
import qualified Data.OpenApi as OPENAPI
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as Text
import HFlags
import qualified Handlers.AccountInfo as Account
import Handlers.QueuedTransactions ()
import Strato.Auth.ClientCredentials (clientCredentialsConfig, discoveryUrl)
import Instrumentation
import Network.HTTP.Types.Status
import Network.Wai
import Network.Wai.Handler.Warp
import Data.String (fromString)
import Network.Wai.Middleware.Cors
import Network.Wai.Middleware.Prometheus
import Network.Wai.Middleware.RequestLogger
import Strato.Tracing (initTracing)
import Strato.Tracing.Wai (tracingMiddleware)
import SQLM
import Servant
import Servant.Multipart
import Servant.OpenApi
import Servant.Swagger.UI
import Text.Tools
import UnliftIO hiding (Handler)
import Prelude hiding (lookup)

-- | The API server monad: one field per former transformer layer.
type ApiRow = '[UrlMap, BlocEnv, CirrusDB, SQLDB, Logger]

newtype ApiM a = ApiM {unApiM :: Eff ApiRow a}
  deriving newtype
    ( Functor,
      Applicative,
      Monad,
      MonadIO,
      MonadUnliftIO,
      MonadLogger,
      Accessible UrlMap,
      Accessible BlocEnv,
      AccessibleEnv SQLDB,
      AccessibleEnv CirrusDB,
      GetLastBlocks,
      GetReceipts,
      GetLastTransactions
    )

instance ApiM `Outputs` [IngestEvent] where
  output = ApiM . output

-- Hand-written rather than derived: 'Selectable' has a constrained default
-- method ('selectWithDefault'), which GeneralizedNewtypeDeriving cannot coerce.
instance Selectable AccountsFilterParams [AddressStateRef] ApiM where
  select p = ApiM . select p

instance Selectable ProxyFilterParams [(AddressStateRef, String)] ApiM where
  select p = ApiM . select p

instance Selectable BlocksFilterParams [Block] ApiM where
  select p = ApiM . select p

instance Selectable Keccak256 [TransactionResult] ApiM where
  select p = ApiM . select p

instance Selectable StorageFilterParams [StorageAddress] ApiM where
  select p = ApiM . select p

instance Selectable TxsFilterParams [RawTransaction] ApiM where
  select p = ApiM . select p

instance (Keccak256 `Selectable` SourceMap) ApiM where
  select _ = getCodeFromPostgres

instance (Keccak256 `Alters` DBCode) ApiM where
  lookup _ k = fmap (fmap Text.encodeUtf8) $ Account.getCodeFromPostgres' k
  insert _ _ _ = error "API: Keccak256 `Alters` DBCode insert"
  delete _ _ = error "API: Keccak256 `Alters` DBCode delete"

instance Selectable FilePath (Either String String) ApiM where
  select p = liftIO . select p

instance Selectable Address AddressState ApiM where
  select _ a = runMaybeT $ do
    (AddressStateRef' r) <-
      MaybeT
        . fmap listToMaybe
        . getAccount'
        $ accountsFilterParams
          & qaAddress ?~ a
    codePtr <- MaybeT . pure $ addressStateRefCodePtr r
    pure $
      AddressState
        (addressStateRefNonce r)
        (addressStateRefBalance r)
        (addressStateRefContractRoot r)
        codePtr
        (Just 0)

-- The sync scalars come from the node_status table (mirrored from the core's
-- Redis by strato-indexer), so the API needs no Redis connection at all.
instance Accessible (Maybe SyncStatus) ApiM where
  access _ = fmap SyncStatus <$> getNodeSyncStatus

instance Accessible (Maybe BestBlock) ApiM where
  access _ = getNodeBestBlock

instance Accessible (Maybe WorldBestBlock) ApiM where
  access _ = getNodeWorldBestBlock

instance Accessible (Maybe BestSequencedBlock) ApiM where
  access _ = getNodeBestSequencedBlock

instance Accessible (Maybe CirrusTip) ApiM where
  access _ = getNodeCirrusTip

type FullAPI = CoreAPI :<|> "bloc" :> "v2.2" :> BlocAPI

fullServer :: MonadBlocAPI m => ServerT FullAPI m
fullServer = coreApiServer :<|> bloc

----------------

-- | The eth and cirrus pools are created once in 'main' and shared by every
-- request. Until 2026-09 each request built (and tore down) its own
-- 20-connection pool per database, which Postgres tolerated over loopback
-- but which multiplies into thousands of connections once several API
-- instances sit in front of a managed cluster.
hoistCoreServer :: SQLDB -> CirrusDB -> BlocEnv -> UrlMap -> Servant.Server FullAPI
hoistCoreServer sqlDb cirrusDb blocEnv urlMap = hoistServer (Proxy :: Proxy FullAPI) convertErrors fullServer
  where
    convertErrors :: ApiM a -> Handler a
    convertErrors x = Handler $ do
      y <- liftIO
        . try
        . runEff
        . runLogging
        . runSQLMWith sqlDb
        . runCirrusMWith cirrusDb
        . provide blocEnv
        . provide urlMap
        . unApiM
        $ x `catch` handleRuntimeError `catch` handleApiError
      case y of
        Right a -> pure a
        Left e -> throwE $ apiErrorToServantErr e

fullAPI :: Proxy FullAPI
fullAPI = Proxy

main :: IO ()
main = do
  _ <- $initHFlags "Core API"

  -- check that all urls are derivable (or else crash and fail in a flaming disaster)
  let urlMap = fromList
        [ ("vault", vaultUrl . urlConfig $ ethConf),
          ("oauthDiscovery", T.unpack $ discoveryUrl clientCredentialsConfig),
          ("notificationServer", notificationServerUrl . urlConfig $ ethConf),
          ("fileServer", fileServerUrl . urlConfig $ ethConf),
          ( "monitor",
            case network (networkConfig ethConf) of
              "mercata-hydrogen" -> "https://monitor.mercata-testnet2.blockapps.net:18080"
              "mercata" -> "https://monitor.mercata.blockapps.net:18080"
              "helium" -> "https://monitor.testnet.strato.nexus"
              "upquark" -> "https://monitor.strato.nexus"
              "lithium" -> "" -- local development network
              _ -> ""
          )
        ]
  _ <- traverseWithKey (\service url' -> putStrLn $ "The url for " <>  service <> " is " <> url') urlMap

  let theDoc =
        addOperationIds $
        toOpenApi (Proxy :: Proxy FullAPI)
          & info . title .~ "Strato API"
          & info . description
            ?~ "This is the great Strato API, which let's \
               \ you query the blockchain."
          & info . version .~ "1.2"

  -- print theDoc
  blockappsInit "core-api"
  runInstrumentation "strato-api"

  let stateFetchLimit' = 100
      -- Seconds a reserved nonce counter stays valid; long enough to cover a
      -- transaction's trip to the indexer under load.
      nonceCounterTimeout = 10

  simCounter <- newTVarIO 0

  sqlDb <- runEff . runLogging $ createSQLDB sqlPoolSize
  cirrusDb <- runEff . runLogging $ createCirrusDB sqlPoolSize
  -- Per-address nonce counters shared by every API instance live in the
  -- writer (Bloc.NonceStore); make sure the table exists.
  ensureNonceCounterTable sqlDb

  let bindHost' = Conf.apiListenAddress (Conf.apiConfig ethConf)
      bindPort = Conf.apiPort (Conf.apiConfig ethConf)
      -- The JSON-RPC server binds where this one does. A wildcard bind (the
      -- API tier's container listens on every interface for its nginx
      -- sidecar) is not an address to connect to, so reach it on loopback.
      rpcHost
        | bindHost' `elem` ["0.0.0.0", "::", "*", "*4", "*6"] = "127.0.0.1"
        | otherwise = bindHost'
  let env =
        BlocEnv
          { Bloc.Monad.txSizeLimit = Conf.txSizeLimit (networkConfig ethConf),
            Bloc.Monad.gasLimit = Conf.gasLimit (networkConfig ethConf),
            Bloc.Monad.stateFetchLimit = stateFetchLimit',
            Bloc.Monad.nonceTtlSeconds = nonceCounterTimeout,
            Bloc.Monad.vmJsonRpcUrl = "http://" ++ rpcHost ++ ":" ++ show Conf.jsonRpcPort,
            Bloc.Monad.simInFlight = simCounter,
            Bloc.Monad.simMaxConcurrent = Conf.simMaxConcurrent (Conf.vmConfig ethConf)
          }
  putStrLn $ "Starting strato-api on " ++ bindHost' ++ ":" ++ show bindPort
  let settings = setPort bindPort $ setHost (fromString bindHost') defaultSettings
  -- Request traces: one server span per request, continuing nginx's
  -- traceparent; enabled by OTEL_EXPORTER_OTLP_ENDPOINT.
  initTracing "strato-api"
  runSettings settings . tracingMiddleware "strato-api" $ app sqlDb cirrusDb env theDoc urlMap

-- | Connections per database for the whole process. Twenty matches the
-- per-request pool size this replaced; -N4 workers rarely hold more than a
-- handful at once.
sqlPoolSize :: Int
sqlPoolSize = 20

app :: SQLDB -> CirrusDB -> BlocEnv -> OpenApi -> UrlMap -> Application
app sqlDb cirrusDb blocEnv theDoc urlMap =
  prometheus def {prometheusInstrumentApp = False} $
    instrumentApp "core-api" $
      logStdoutDev $
        cors (const $ Just simpleCorsResourcePolicy {corsRequestHeaders = ["Content-Type"]})
        --  $ serve (Proxy :: Proxy (CoreAPI :<|> SwaggerSchemaUI "openapi-ui" "openapi.json")) $ (coreServer pool :<|> swaggerSchemaUIServer theDoc)
        $
          addPathsTo404 $
            serve (Proxy :: Proxy (FullAPI :<|> SwaggerSchemaUI "openapi-ui" "openapi.json")) $
              hoistCoreServer sqlDb cirrusDb blocEnv urlMap :<|> swaggerSchemaUIServer theDoc

addPathsTo404 :: Middleware
addPathsTo404 baseApp req respond' =
  baseApp req $ \response -> do
    if responseStatus response /= status404
      then respond' response
      else
        respond' $
          responseLBS notFound404 [("Content-Type", "text/plain")] $
            BLC.pack $
              "There is no content at: \"" ++ BC.unpack (requestMethod req) ++ " " ++ BC.unpack (rawPathInfo req) ++ "\""
                ++ "\nHere are the available routes:"
                ++ tab ("\n" ++ unlines allPaths)
                ++ "\n"
  where
    allPaths = H.keys $ _openApiPaths $ toOpenApi (Proxy :: Proxy FullAPI)

----------

-- | Add operationId to all operations based on path and method
-- This makes CLI tools like restish generate cleaner command names
addOperationIds :: OpenApi -> OpenApi
addOperationIds swagger = swagger & OPENAPI.paths %~ H.mapWithKey addIdsToPathItem
  where
    addIdsToPathItem :: FilePath -> PathItem -> PathItem
    addIdsToPathItem apiPath item = item
      & OPENAPI.get    %~ fmap (setOpId "get" apiPath)
      & OPENAPI.put    %~ fmap (setOpId "put" apiPath)
      & OPENAPI.post   %~ fmap (setOpId "post" apiPath)
      & OPENAPI.delete %~ fmap (setOpId "delete" apiPath)
      & OPENAPI.patch  %~ fmap (setOpId "patch" apiPath)

    setOpId :: Text -> FilePath -> Operation -> Operation
    setOpId method apiPath op = op & OPENAPI.operationId ?~ generateOperationId method apiPath

    -- Convert "/eth/v1.2/account" + "get" -> "getAccount"
    -- Convert "/bloc/v2.2/contracts/{contractName}" + "get" -> "getContract"
    generateOperationId :: Text -> FilePath -> Text
    generateOperationId method apiPath =
      let segments = filter (not . T.null) $ T.splitOn "/" $ T.pack apiPath
          -- Remove version segments like "v1.2", "v2.2"
          withoutVersion = filter (not . isVersion) segments
          -- Convert path params {foo} to "ByFoo"
          cleaned = map cleanSegment withoutVersion
          -- Take last 1-2 meaningful segments for the opName
          nameParts = takeEnd 2 cleaned
          opName = T.concat nameParts
      in method <> capitalizeFirst opName

    isVersion :: Text -> Bool
    isVersion t = T.isPrefixOf "v" t && T.any (== '.') t

    cleanSegment :: Text -> Text
    cleanSegment seg
      | T.isPrefixOf "{" seg && T.isSuffixOf "}" seg =
          "By" <> capitalizeFirst (T.drop 1 $ T.dropEnd 1 seg)
      | otherwise = capitalizeFirst seg

    capitalizeFirst :: Text -> Text
    capitalizeFirst t = case T.uncons t of
      Nothing -> t
      Just (c, rest) -> T.cons (toUpperChar c) rest
      where
        toUpperChar c
          | c >= 'a' && c <= 'z' = toEnum (fromEnum c - 32)
          | otherwise = c

    takeEnd :: Int -> [a] -> [a]
    takeEnd n xs = drop (length xs - n) xs

----------

-- Temporary location for a couple of instance definitions needed for toSwagger, we need to find a better place

instance HasOpenApi a => HasOpenApi (MultipartForm Mem (MultipartData Mem) :> a) where
  toOpenApi _ = toOpenApi (Proxy :: Proxy a)

-----------

