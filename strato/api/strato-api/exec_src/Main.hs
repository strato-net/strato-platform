{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
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
import Bloc.Server
import BlockApps.Init
import BlockApps.Logging
import Blockchain.DB.CodeDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.AddressStateRef
import Blockchain.Data.DataDefs
import Blockchain.EthConf
import qualified Blockchain.EthConf.Model as Conf
import Blockchain.Model.JsonBlock
import Blockchain.Model.SyncState (BestBlock, WorldBestBlock(..))
import Blockchain.Strato.Discovery.Data.PeerIOWiring ()
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.RedisBlockDB
import Blockchain.SyncDB
import Control.Lens.Operators
import Control.Monad.Change.Alter
import Control.Monad.Change.Modify
import Control.Monad.Composable.SQL
import Control.Monad.Composable.Vault
import Control.Monad.Trans.Class
import Control.Monad.Trans.Except
import Control.Monad.Trans.Maybe
import Control.Monad.Trans.Reader
import Core.API hiding (nodePubKey)
import Data.Aeson
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy.Char8 as BLC
import qualified Data.Cache as Cache
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
import Strato.Auth.ClientCredentials (clientCredentialsConfig, discoveryUrl)
import Instrumentation
import Network.HTTP.Types.Status
import Network.Wai
import Network.Wai.Handler.Warp
import Data.String (fromString)
import Network.Wai.Middleware.Cors
import Network.Wai.Middleware.Prometheus
import Network.Wai.Middleware.RequestLogger
import SQLM
import Servant
import Servant.Multipart
import Servant.OpenApi
import Servant.Swagger.UI
import qualified Strato.Strato23.API.Types as V
import Strato.Strato23.Client
import System.Clock
import System.Directory (getCurrentDirectory, doesFileExist)
import qualified System.IO as SIO
import Text.Tools
import UnliftIO hiding (Handler)
import Prelude hiding (lookup)

instance {-# OVERLAPPING #-} MonadUnliftIO m => (Keccak256 `Selectable` SourceMap) (SQLM m) where
  select _ = getCodeFromPostgres

instance {-# OVERLAPPING #-} (Keccak256 `Selectable` SourceMap) m => (Keccak256 `Selectable` SourceMap) (ReaderT a m) where
  select p = lift . select p

instance {-# OVERLAPPING #-} MonadUnliftIO m => (Keccak256 `Alters` DBCode) (SQLM m) where
  lookup _ k = fmap (fmap Text.encodeUtf8) $ Account.getCodeFromPostgres' k
  insert _ _ _ = error "API: Keccak256 `Alters` DBCode insert"
  delete _ _ = error "API: Keccak256 `Alters` DBCode delete"

instance (Keccak256 `Alters` DBCode) m => (Keccak256 `Alters` DBCode) (ReaderT a m) where
  lookup p = lift . lookup p
  insert p k = lift . insert p k
  delete p = lift . delete p

instance {-# OVERLAPPING #-} MonadUnliftIO m => Selectable Address AddressState (SQLM m) where
  select _ a = runMaybeT $ do
    (AddressStateRef' r _) <-
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

instance {-# OVERLAPPING #-} Selectable Address AddressState m => Selectable Address AddressState (ReaderT a m) where
  select p = lift . select p

instance {-# OVERLAPPING #-} MonadUnliftIO m => Accessible V.PublicKey (ReaderT BlocEnv m) where
  access _ = asks nodePubKey

instance {-# OVERLAPPING #-} (Monad m, Accessible V.PublicKey m) => Accessible V.PublicKey (ReaderT a m) where
  access = lift . access

instance {-# OVERLAPPING #-} Accessible (Maybe SyncStatus) IO where
  access _ = fmap SyncStatus <$> runStratoRedisIO getSyncStatus

instance {-# OVERLAPPING #-} Accessible (Maybe BestBlock) IO where
  access _ = runStratoRedisIO getBestBlockInfo

instance {-# OVERLAPPING #-} Accessible (Maybe WorldBestBlock) IO where
  access _ = fmap WorldBestBlock <$> runStratoRedisIO getWorldBestBlockInfo

type FullAPI = Header "X-USER-ACCESS-TOKEN" Text :> (CoreAPI :<|> "bloc" :> "v2.2" :> BlocAPI)

newtype AccessToken = AccessToken { getAccessToken :: Maybe Text }

instance {-# OVERLAPPING #-} (MonadIO m, MonadLogger m, Accessible VaultData m) => HasVault (ReaderT AccessToken m) where
  sign msgHash = do
    AccessToken jwtToken <- ask
    case jwtToken of
      Nothing -> error "sign: missing user access token"
      Just token -> blocVaultWrapperWithUserToken token $ postSignature Nothing (V.MsgHash msgHash)
  getPub = do
    AccessToken jwtToken <- ask
    case jwtToken of
      Nothing -> error "getPub: missing user access token"
      Just token -> fmap V.unPubKey . blocVaultWrapperWithUserToken token $ getKey Nothing Nothing
  getShared _ = error "getShared ReaderT VaultData: unimplemented"

fullServer ::
  ( MonadBlocAPI n,
    n ~ ReaderT AccessToken m
  ) =>
  ServerT FullAPI m
fullServer jwtToken = hoistServer (Proxy :: Proxy CoreAPI) (flip runReaderT (AccessToken jwtToken)) coreApiServer
                 :<|> hoistServer (Proxy :: Proxy BlocAPI) (flip runReaderT (AccessToken jwtToken)) bloc

----------------

hoistCoreServer :: BlocEnv -> UrlMap -> Servant.Server FullAPI
hoistCoreServer blocEnv urlMap = hoistServer (Proxy :: Proxy FullAPI) convertErrors fullServer
  where
    convertErrors :: VaultM (ReaderT UrlMap (ReaderT BlocEnv (CirrusM (SQLM (LoggingT IO))))) a -> Handler a
    convertErrors x = Handler $ do
      y <- liftIO
        . try
        . runLoggingT
        . runSQLM
        . runCirrusM
        . flip runReaderT blocEnv
        . flip runReaderT urlMap
        . runVaultM (vaultUrl . urlConfig $ ethConf)
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
      nonceCounterTimeout = 10

  nonceCache <- Cache.newCache . Just $ TimeSpec nonceCounterTimeout 0

  -- Debug: check OAuth credentials and token cache
  cwd <- getCurrentDirectory
  SIO.hPutStrLn SIO.stderr ("DEBUG: Current working directory: " ++ cwd) >> SIO.hFlush SIO.stderr
  oauthExists <- doesFileExist "secrets/oauth_credentials.yaml"
  SIO.hPutStrLn SIO.stderr ("DEBUG: secrets/oauth_credentials.yaml exists: " ++ show oauthExists) >> SIO.hFlush SIO.stderr
  tokenExists <- doesFileExist "secrets/oauth_token"
  SIO.hPutStrLn SIO.stderr ("DEBUG: secrets/oauth_token (cached) exists: " ++ show tokenExists) >> SIO.hFlush SIO.stderr
  SIO.hPutStrLn SIO.stderr ("DEBUG: About to call Vault at: " ++ vaultUrl (urlConfig ethConf)) >> SIO.hFlush SIO.stderr
  
  pubKey <- runLoggingT
          . runVaultM (vaultUrl . urlConfig $ ethConf)
          . fmap V.unPubKey
          . blocVaultWrapper
          $ getKey Nothing Nothing
  
  SIO.hPutStrLn SIO.stderr "DEBUG: Vault call completed successfully" >> SIO.hFlush SIO.stderr

  SIO.hPutStrLn SIO.stderr "DEBUG: Creating BlocEnv..." >> SIO.hFlush SIO.stderr
  let env =
        BlocEnv
          { Bloc.Monad.txSizeLimit = Conf.txSizeLimit (networkConfig ethConf),
            Bloc.Monad.gasLimit = Conf.gasLimit (networkConfig ethConf),
            Bloc.Monad.stateFetchLimit = stateFetchLimit',
            Bloc.Monad.globalNonceCounter = nonceCache,
            Bloc.Monad.nodePubKey = pubKey
          }
  SIO.hPutStrLn SIO.stderr "DEBUG: BlocEnv created" >> SIO.hFlush SIO.stderr
  let bindHost = ipAddress $ apiConfig ethConf
      bindPort = 3000 :: Int
  SIO.hPutStrLn SIO.stderr ("DEBUG: About to start server on " ++ bindHost ++ ":" ++ show bindPort) >> SIO.hFlush SIO.stderr
  putStrLn $ "Starting strato-api on " ++ bindHost ++ ":" ++ show bindPort
  SIO.hFlush SIO.stdout
  SIO.hPutStrLn SIO.stderr "DEBUG: Calling runSettings now..." >> SIO.hFlush SIO.stderr
  runSettings (setPort bindPort $ setHost (fromString bindHost) defaultSettings) $ app env theDoc urlMap

app :: BlocEnv -> OpenApi -> UrlMap -> Application
app blocEnv theDoc urlMap =
  prometheus def {prometheusInstrumentApp = False} $
    instrumentApp "core-api" $
      logStdoutDev $
        cors (const $ Just simpleCorsResourcePolicy {corsRequestHeaders = ["Content-Type"]})
        --  $ serve (Proxy :: Proxy (CoreAPI :<|> SwaggerSchemaUI "openapi-ui" "openapi.json")) $ (coreServer pool :<|> swaggerSchemaUIServer theDoc)
        $
          addPathsTo404 $
            serve (Proxy :: Proxy (FullAPI :<|> SwaggerSchemaUI "openapi-ui" "openapi.json")) $
              hoistCoreServer blocEnv urlMap :<|> swaggerSchemaUIServer theDoc

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

instance ToSchema Value where
  declareNamedSchema _ =
    return $
      NamedSchema (Just "JSON Value") mempty

-----------
