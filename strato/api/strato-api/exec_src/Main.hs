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
import Blockchain.Model.JsonBlock
import Blockchain.Model.SyncState (BestBlock, WorldBestBlock(..))
import Blockchain.Strato.Discovery.Data.PeerIOWiring ()
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Options
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.RedisBlockDB
import Blockchain.SyncDB
import Control.Lens.Operators
import Control.Monad.Change.Alter
import Control.Monad.Change.Modify
import Control.Monad.Composable.SQL
import Control.Monad.Composable.Vault hiding (httpManager)
import Control.Monad.Trans.Class
import Control.Monad.Trans.Except
import Control.Monad.Trans.Maybe
import Control.Monad.Trans.Reader
import Core.API
import Data.Aeson
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy.Char8 as BLC
import qualified Data.Cache as Cache
import qualified Data.HashMap.Strict.InsOrd as H
import Data.Map (fromList, traverseWithKey)
import Data.Maybe (listToMaybe)
import Data.Source.Map
import Data.Swagger hiding (Header, Http, delete)
import Data.Text (Text)
import qualified Data.Text.Encoding as Text
import HFlags
import qualified Handlers.AccountInfo as Account
import Handlers.Options
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
import Servant.Swagger
import Servant.Swagger.UI
import qualified Strato.Strato23.API.Types as V
import Strato.Strato23.Client
import System.Clock
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
    blocVaultWrapper $ postSignature jwtToken (V.MsgHash msgHash)
  getPub = do
    AccessToken jwtToken <- ask
    fmap V.unPubKey . blocVaultWrapper $ getKey jwtToken Nothing
  getShared _ = error "getShared ReaderT VaultData: unimplemented"

fullServer ::
  ( MonadBlocAPI n,
    n ~ ReaderT AccessToken m
  ) =>
  ServerT FullAPI m
fullServer jwtToken = hoistServer (Proxy :: Proxy CoreAPI) (flip runReaderT (AccessToken jwtToken)) coreApiServer
                 :<|> hoistServer (Proxy :: Proxy BlocAPI) (flip runReaderT (AccessToken jwtToken)) bloc

----------------

hoistCoreServer :: BlocEnv -> UrlMap -> Server FullAPI
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
        . runVaultM ("http://localhost:8013/strato/v2.3")
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
        [ ("vault", flags_vaultUrl),
          ("oauthDiscovery", flags_oauthDiscoveryUrl),
          ("notificationServer", flags_notificationServerUrl),
          ( "fileServer",
            case (flags_fileServerUrl, flags_network) of
              ("", "mercata-hydrogen") -> "https://fileserver.mercata-testnet2.blockapps.net/highway"
              ("", 'h':'e':'l':'i':'u':'m':_) -> "https://fileserver.mercata.blockapps.net/highway"
              ("", "upquark") -> "https://fileserver.mercata.blockapps.net/highway"
              ("", "mercata") -> "https://fileserver.mercata.blockapps.net/highway"
              ("", "uranium") -> "https://fileserver.mercata.blockapps.net/highway"
              ("", _) -> error "File server url was not provided and cannot be derived"
              (fileServer, _) -> fileServer
          ),
          ( "monitor",
            case flags_network of
              "mercata-hydrogen" -> "https://monitor.mercata-testnet2.blockapps.net:18080"
              "mercata" -> "https://monitor.mercata.blockapps.net:18080"
              "helium" -> "https://monitor.testnet.stratomercata.com"
              "upquark" -> "https://monitor.stratomercata.com"
              _ -> ""
          )
        ]
  _ <- traverseWithKey (\service url' -> putStrLn $ "The url for " <>  service <> " is " <> url') urlMap

  let theDoc =
        toSwagger (Proxy :: Proxy FullAPI)
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

  pubKey <- runLoggingT
          . runVaultM ("http://localhost:8013/strato/v2.3")
          . fmap V.unPubKey
          . blocVaultWrapper
          $ getKey Nothing Nothing

  let env =
        BlocEnv
          { txSizeLimit = flags_txSizeLimit,
            gasLimit = flags_gasLimit,
            stateFetchLimit = stateFetchLimit',
            globalNonceCounter = nonceCache,
            nodePubKey = pubKey
          }
  runSettings (setPort 3000 $ setHost (fromString $ ipAddress $ apiConfig ethConf) defaultSettings) $ app env theDoc urlMap

app :: BlocEnv -> Swagger -> UrlMap -> Application
app blocEnv theDoc urlMap =
  prometheus def {prometheusInstrumentApp = False} $
    instrumentApp "core-api" $
      logStdoutDev $
        cors (const $ Just simpleCorsResourcePolicy {corsRequestHeaders = ["Content-Type"]})
        --  $ serve (Proxy :: Proxy (CoreAPI :<|> SwaggerSchemaUI "swagger-ui" "swagger.json")) $ (coreServer pool :<|> swaggerSchemaUIServer theDoc)
        $
          addPathsTo404 $
            serve (Proxy :: Proxy (FullAPI :<|> SwaggerSchemaUI "swagger-ui" "swagger.json")) $
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
    allPaths = H.keys $ _swaggerPaths $ toSwagger (Proxy :: Proxy FullAPI)

----------

-- Temporary location for a couple of instance definitions needed for toSwagger, we need to find a better place

instance HasSwagger a => HasSwagger (MultipartForm Mem (MultipartData Mem) :> a) where
  toSwagger _ = toSwagger (Proxy :: Proxy a)

instance ToSchema Value where
  declareNamedSchema _ =
    return $
      NamedSchema (Just "JSON Value") mempty

-----------
