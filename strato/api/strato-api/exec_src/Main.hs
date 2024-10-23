{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE KindSignatures #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

{-# OPTIONS -fno-warn-orphans #-}

module Main where

import API.Parametric
import Bloc.API
-- hiding (handleRuntimeError)
import Bloc.Database.Queries
import Bloc.Monad
import Bloc.Server
import Bloc.Server.Utils (toMaybe)
import BlockApps.Init
import BlockApps.Logging
import Blockchain.DB.CodeDB
import Blockchain.Data.AddressStateDB
import Blockchain.Data.AddressStateRef
import Blockchain.Data.CirrusDefs
import Blockchain.Data.DataDefs
import Blockchain.Data.Json
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Options
import Control.Lens.Operators
import Control.Monad.Change.Alter
import Control.Monad.Change.Modify (Accessible(..))
import Control.Monad.Composable.Identity
import Control.Monad.Composable.SQL
import Control.Monad.Composable.Strato hiding (httpManager)
import Control.Monad.Composable.Vault hiding (httpManager)
import Control.Monad.Trans.Except
import Control.Monad.Trans.Maybe
import Control.Monad.Trans.Reader
import Data.Aeson
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy.Char8 as BLC
import qualified Data.Cache as Cache
import qualified Data.HashMap.Strict.InsOrd as H
import Data.Map (fromList, traverseWithKey)
import Data.Maybe (fromJust, isJust, listToMaybe, maybeToList)
import Data.Source.Map
import Data.Swagger hiding (Http, delete)
import Data.Text (Text)
import Data.Text.Encoding (encodeUtf8)
import GHC.Stack
import HFlags
import qualified Handlers.AccountInfo as Account
import qualified Handlers.BatchTransactionResult as BatchTransactionResult
import qualified Handlers.BlkLast as BlkLast
import qualified Handlers.Block as Block
import qualified Handlers.Chain as Chain
import qualified Handlers.Faucet as Faucet
import qualified Handlers.IdentityServerCallback as Identity
import qualified Handlers.Metadata as Metadata
import Handlers.Options
import qualified Handlers.Peers as Peers
import qualified Handlers.QueuedTransactions as QueuedTransactions
import qualified Handlers.Stats as Stats
import qualified Handlers.Storage as Storage
import qualified Handlers.SyncStatus as SyncStatus
import qualified Handlers.Transaction as Transaction
import qualified Handlers.TransactionResult as TransactionResult
import qualified Handlers.TxLast as TxLast
import Instrumentation
import Network.HTTP.Types.Status
import Network.Wai
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Cors
import Network.Wai.Middleware.Prometheus
import Network.Wai.Middleware.RequestLogger
import Options
import SQLM
import Servant
import Servant.Client
import Servant.Multipart
import Servant.Multipart.Client ()
import Servant.Swagger
import Servant.Swagger.UI
import SolidVM.Model.CodeCollection.Contract
import System.Clock
import Text.Regex
import Text.Tools
import UnliftIO hiding (Handler)
import Prelude hiding (lookup)

instance (MonadUnliftIO m, MonadLogger m, HasStrato m) => Selectable Account Contract (ReaderT r m) where
  select _ a = runMaybeT $ do
    (AddressStateRef' r _) <-
      MaybeT
        . fmap listToMaybe
        . blocStrato
        . Account.getAccountsClient
        $ Account.accountsFilterParams
          & Account.qaAddress ?~ (a ^. accountAddress)
          & Account.qaChainId .~ (fmap ChainId . maybeToList $ a ^. accountChainId)
    codePtr <- MaybeT . pure $ addressStateRefCodePtr r
    MaybeT $ either (const Nothing) (Just . snd) <$> getContractDetailsByCodeHash codePtr

instance (MonadUnliftIO m, MonadLogger m, HasStrato m) => (Keccak256 `Selectable` SourceMap) (ReaderT r m) where
  select _ k = do
    (eSrc :: Either SomeException SourceMap) <- try . blocStrato $ client (Proxy @Account.CodeAPI) k
    case eSrc of
      Left _ -> pure Nothing
      Right r -> pure $ Just r

-- eitherToMaybe
e2m :: Either a b -> Maybe b
e2m (Right b) = Just b
e2m _         = Nothing

instance (MonadUnliftIO m, MonadLogger m, HasStrato m) => (Keccak256 `Alters` DBCode) (ReaderT r m) where
  lookup _ k = do
    (eRaw :: Either SomeException Text) <- try . blocStrato $ client (Proxy @Account.RawCodeAPI) k
    pure . fmap (SolidVM,) $ e2m . B16.decode . encodeUtf8 =<< e2m eRaw
  insert _ _ _ = error "API: Keccak256 `Alters` DBCode insert"
  delete _ _ = error "API: Keccak256 `Alters` DBCode delete"

instance (MonadUnliftIO m, MonadLogger m, HasStrato m) => Selectable Account AddressState (ReaderT r m) where
  select _ a = runMaybeT $ do
    (AddressStateRef' r _) <-
      MaybeT
        . fmap listToMaybe
        . blocStrato
        . Account.getAccountsClient
        $ Account.accountsFilterParams
          & Account.qaAddress ?~ (a ^. accountAddress)
          & Account.qaChainId .~ (fmap ChainId . maybeToList $ a ^. accountChainId)
    codePtr <- MaybeT . pure $ addressStateRefCodePtr r
    pure $
      AddressState
        (addressStateRefNonce r)
        (addressStateRefBalance r)
        (addressStateRefContractRoot r)
        codePtr
        (toMaybe 0 $ addressStateRefChainId r)

instance (MonadUnliftIO m, MonadLogger m, HasStrato m) => Selectable Address Certificate (ReaderT r m) where
  select _ k = do
    (eCert :: Either SomeException Certificate)  <- try . blocStrato $ client (Proxy @Account.GetX509) k
    case eCert of
      Left _ -> pure Nothing
      Right r -> pure $ Just r

type CoreAPI =
  "eth" :> "v1.2"
    :> ( Account.API
           :<|> Account.CodeAPI
           :<|> Account.RawCodeAPI
           :<|> Account.GetX509
           :<|> BatchTransactionResult.API
           :<|> BlkLast.API
           :<|> Block.API
           :<|> Chain.API
           :<|> Faucet.API
           :<|> Identity.API
           :<|> Metadata.API
           :<|> Peers.API
           :<|> QueuedTransactions.API
           :<|> Stats.API
           :<|> Storage.API
           :<|> SyncStatus.API
           :<|> Transaction.API
           :<|> TransactionResult.API
           :<|> TxLast.API
       )

type FullAPI' r hs = CoreAPI :<|> "bloc" :> "v2.2" :> BlocAPI r hs
type FullAPI = FullAPI' '[Required, Strict] '[]
type FullAPIOAuth = FullAPI' '[Required, Strict] InternalHeaders
type FullAPIExternal = FullAPI' '[Optional, Strict] ExternalHeaders

coreServer ::
  ( MonadLogger m,
    HasSQL m,
    HasCirrus m,
    Accessible Metadata.UrlMap m,
    Accessible IdentityData m,
    Accessible VaultData m
  ) =>
  ServerT CoreAPI m
coreServer =
  Account.server
    :<|> Account.codeServer
    :<|> Account.rawCodeServer
    :<|> Account.getX509Server
    :<|> BatchTransactionResult.server
    :<|> BlkLast.server
    :<|> Block.server
    :<|> Chain.server
    :<|> Faucet.server
    :<|> Identity.server
    :<|> Metadata.server
    :<|> Peers.server
    :<|> QueuedTransactions.server
    :<|> Stats.server
    :<|> Storage.server
    :<|> SyncStatus.server
    :<|> Transaction.server flags_txSizeLimit
    :<|> TransactionResult.server
    :<|> TxLast.server

coreProxyServer ::
  ( MonadUnliftIO m,
    MonadLogger m,
    HasIdentity m,
    HasStrato m,
    HasCallStack,
    Accessible Metadata.UrlMap m,
    Selectable Keccak256 SourceMap m
  ) =>
  ServerT CoreAPI m
coreProxyServer =
    (\a b c d e f g h i j k l m n o p q -> blocStrato $ (client (Proxy @Account.API) a b c d e f g h i j k l m n o p q))
    :<|> (\a -> blocStrato $ client (Proxy @Account.CodeAPI) a)
    :<|> (\a -> blocStrato $ client (Proxy @Account.RawCodeAPI) a)
    :<|> (\a -> blocStrato $ client (Proxy @Account.GetX509) a)
    :<|> (\a -> blocStrato $ client (Proxy @BatchTransactionResult.API) a)
    :<|> (\a -> blocStrato $ client (Proxy @BlkLast.API) a)
    :<|> (\a b c d e f g h i j k l m n o p q r s t -> blocStrato $ client (Proxy @Block.API) a b c d e f g h i j k l m n o p q r s t)
    :<|> ((\a b c d -> blocStrato $ Chain.getChainClient a b c d)
      :<|> (\a -> blocStrato $ Chain.postChainClient a)
      :<|> (\a -> blocStrato $ Chain.postChainsClient a))
    :<|> ((\a -> blocStrato $ client (Proxy @Faucet.PostFaucet) a)
      :<|> (error "PostFaucetMultipart") -- (\_ -> blocStrato $ client (Proxy @Faucet.PostFaucetMultipart)) -- TODO
      :<|> (\a b -> blocStrato $ client (Proxy @Faucet.PostDataFaucet) a b))
    :<|> Identity.server
    :<|> (do
          md <- blocStrato $ client (Proxy @Metadata.API)
          urlMap <- access (Proxy @Metadata.UrlMap)
          pure $ md{Metadata.urls = urlMap}
         )
    :<|> (blocStrato $ client (Proxy @Peers.API))
    :<|> (blocStrato $ client (Proxy @QueuedTransactions.API))
    :<|> ((blocStrato $ client (Proxy @Stats.TotalTxAPI))
      :<|> (blocStrato $ client (Proxy @Stats.TotalDifficultyAPI)))
    :<|> (\a b c d e f g h i j k -> blocStrato $ client (Proxy @Storage.API) a b c d e f g h i j k)
    :<|> (blocStrato $ client (Proxy @SyncStatus.API))
    :<|> ((\a b c d e f g h i j k l m n o p q -> blocStrato $ client (Proxy @Transaction.GetTransaction) a b c d e f g h i j k l m n o p q)
      :<|> (\a -> blocStrato $ client (Proxy @Transaction.PostTransaction) a)
      :<|> (\a -> blocStrato $ client (Proxy @Transaction.PostTransactionList) a))
    :<|> (\a -> blocStrato $ client (Proxy @TransactionResult.API) a)
    :<|> (\a b -> blocStrato $ client (Proxy @TxLast.API) a b)

fullServer ::
  ( MonadLogger m,
    HasSQL m,
    HasCirrus m,
    HasBlocEnv m,
    HasIdentity m,
    HasVault m,
    HasStrato m,
    Accessible Metadata.UrlMap m,
    Selectable Account Contract m,
    Selectable Account AddressState m,
    Selectable Address Certificate m,
    HasCodeDB m,
    Selectable Keccak256 SourceMap m
  ) =>
  ServerT FullAPI m
fullServer = coreServer :<|> blocSimple (Proxy :: Proxy ('[] :: [Symbol]))

fullServerProxyCore ::
  ( MonadLogger m,
    MonadUnliftIO m,
    HasBlocEnv m,
    HasIdentity m,
    HasVault m,
    HasStrato m,
    Accessible Metadata.UrlMap m,
    Selectable Account Contract m,
    Selectable Account AddressState m,
    Selectable Address Certificate m,
    HasCodeDB m,
    Selectable Keccak256 SourceMap m
  ) =>
  ServerT FullAPI m
fullServerProxyCore = coreProxyServer :<|> blocSimple (Proxy :: Proxy ('[] :: [Symbol]))

fullServerOauth ::
  ( MonadLogger m,
    HasSQL m,
    HasCirrus m,
    HasBlocEnv m,
    HasIdentity m,
    HasVault m,
    HasStrato m,
    Accessible Metadata.UrlMap m,
    Selectable Account Contract m,
    Selectable Account AddressState m,
    Selectable Address Certificate m,
    HasCodeDB m,
    Selectable Keccak256 SourceMap m
  ) =>
  ServerT FullAPIOAuth m
fullServerOauth = coreServer :<|> blocOauth (Proxy :: Proxy InternalHeaders)

fullServerOauthProxyCore ::
  ( MonadLogger m,
    MonadUnliftIO m,
    HasBlocEnv m,
    HasIdentity m,
    HasVault m,
    HasStrato m,
    Accessible Metadata.UrlMap m,
    Selectable Account Contract m,
    Selectable Account AddressState m,
    Selectable Address Certificate m,
    HasCodeDB m,
    Selectable Keccak256 SourceMap m
  ) =>
  ServerT FullAPIOAuth m
fullServerOauthProxyCore = coreProxyServer :<|> blocOauth (Proxy :: Proxy InternalHeaders)

----------------

hoistCoreServer :: BlocEnv -> Metadata.UrlMap -> Server FullAPI
hoistCoreServer blocEnv urlMap = hoistServer (Proxy :: Proxy FullAPI) (convertErrors runM) fullServer
  where
    convertErrors r x = Handler $ do
      y <- liftIO . try . r $ x `catch` handleRuntimeError `catch` handleApiError
      case y of
        Right a -> pure a
        Left e -> throwE $ apiErrorToServantErr e
    runM f =
      runLoggingT
        . runSQLM
        . runCirrusM
        . flip runReaderT blocEnv
        . flip runReaderT urlMap
        . runStratoM (flags_stratoUrl ++ "/eth/v1.2")
        . runVaultM ("http://localhost:8013/strato/v2.3")
        . runIdentitytM getIdentityServerUrl
        $ f

hoistCoreServerProxyCore :: BlocEnv -> Metadata.UrlMap -> Server FullAPI
hoistCoreServerProxyCore blocEnv urlMap = hoistServer (Proxy :: Proxy FullAPI) (convertErrors runM) fullServerProxyCore
  where
    convertErrors r x = Handler $ do
      y <- liftIO . try . r $ x `catch` handleRuntimeError `catch` handleApiError
      case y of
        Right a -> pure a
        Left e -> throwE $ apiErrorToServantErr e
    runM f =
      runLoggingT
        . flip runReaderT blocEnv
        . flip runReaderT urlMap
        . runStratoM (flags_stratoUrl ++ "/eth/v1.2")
        . runVaultM ("http://localhost:8013/strato/v2.3")
        . runIdentitytM getIdentityServerUrl
        $ f

hoistCoreServerOauth :: BlocEnv -> Metadata.UrlMap -> Server FullAPIOAuth
hoistCoreServerOauth blocEnv urlMap = hoistServer (Proxy :: Proxy FullAPIOAuth) (convertErrors runM) fullServerOauth
  where
    convertErrors r x = Handler $ do
      y <- liftIO . try . r $ x `catch` handleRuntimeError `catch` handleApiError
      case y of
        Right a -> pure a
        Left e -> throwE $ apiErrorToServantErr e
    runM f =
      runLoggingT
        . runSQLM
        . runCirrusM
        . flip runReaderT blocEnv
        . flip runReaderT urlMap
        . runStratoM (flags_stratoUrl ++ "/eth/v1.2")
        . runVaultM ("http://localhost:8013/strato/v2.3")
        . runIdentitytM getIdentityServerUrl
        $ f

hoistCoreServerOauthProxyCore :: BlocEnv -> Metadata.UrlMap -> Server FullAPIOAuth
hoistCoreServerOauthProxyCore blocEnv urlMap = hoistServer (Proxy :: Proxy FullAPIOAuth) (convertErrors runM) fullServerOauthProxyCore
  where
    convertErrors r x = Handler $ do
      y <- liftIO . try . r $ x `catch` handleRuntimeError `catch` handleApiError
      case y of
        Right a -> pure a
        Left e -> throwE $ apiErrorToServantErr e
    runM f =
      runLoggingT
        . flip runReaderT blocEnv
        . flip runReaderT urlMap
        . runStratoM (flags_stratoUrl ++ "/eth/v1.2")
        . runVaultM ("http://localhost:8013/strato/v2.3")
        . runIdentitytM getIdentityServerUrl
        $ f

fullAPI :: Proxy FullAPI
fullAPI = Proxy

fullAPIOauth :: Proxy FullAPIOAuth
fullAPIOauth = Proxy

main :: IO ()
main = do
  _ <- $initHFlags "Core API"

  -- check if id server connection is valid; only run if using https (unless using localhost)
  identityUrl <- parseBaseUrl getIdentityServerUrl
  let allowedIPAddressRegex = "^172.17.((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\\.){1}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])$"
  let matches = matchRegex (mkRegex allowedIPAddressRegex) (baseUrlHost identityUrl)
      baseHost = baseUrlHost identityUrl
      allowedHttpHosts = ["localhost", "docker.for.mac.localhost"]
  if baseUrlScheme identityUrl == Http && not (or [isJust matches, any (== baseHost) allowedHttpHosts])
    then error $ "Will not communicate with the identity server over http unless it is with localhost. Update the idServerUrl: " <> getIdentityServerUrl
    else putStrLn "Identity server url is valid to connect to"

  -- check that all urls are derivable (or else crash and fail in a flaming disaster)
  let urlMap = fromList
        [ ("vault", flags_vaultUrl),
          ("oauthDiscovery", flags_oauthDiscoveryUrl),
          ("notificationServer", flags_notificationServerUrl),
          ( "fileServer",
            case (flags_fileServerUrl, computeNetworkID) of
              ("", 7596898649924658542) -> "https://fileserver.mercata-testnet2.blockapps.net/highway"
              ("", 6909499098523985262) -> "https://fileserver.mercata.blockapps.net/highway"
              ("", _) -> error "File server url was not provided and cannot be derived"
              (fileServer, _) -> fileServer
          ),
          ( "monitor",
            case computeNetworkID of
              7596898649924658542 -> "https://monitor.mercata-testnet2.blockapps.net:18080"
              6909499098523985262 -> "https://monitor.mercata.blockapps.net:18080"
              _ -> ""
          )
        ]
  _ <- traverseWithKey (\service url' -> putStrLn $ "The url for " <>  service <> " is " <> url') urlMap

  let theDoc =
        toSwagger (Proxy :: Proxy FullAPIExternal)
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
      txQueueSize = 4096

  nonceCache <- Cache.newCache . Just $ TimeSpec nonceCounterTimeout 0
  tbqueue <- newTBQueueIO txQueueSize

  let env =
        BlocEnv
          { txSizeLimit = flags_txSizeLimit,
            accountNonceLimit = flags_accountNonceLimit,
            gasLimit = flags_gasLimit,
            stateFetchLimit = stateFetchLimit',
            globalNonceCounter = nonceCache,
            txTBQueue = tbqueue,
            userRegistryAddress = fromJust $ stringAddress flags_userRegistryAddress,
            userRegistryCodeHash = if flags_useBuiltinUserRegistry then Nothing else stringKeccak256 flags_userRegistryCodeHash,
            useWalletsByDefault = flags_useWalletsByDefault
          }
  run 3000 $ app env theDoc urlMap

app :: BlocEnv -> Swagger -> Metadata.UrlMap -> Application
app blocEnv theDoc urlMap =
  prometheus def {prometheusInstrumentApp = False} $
    instrumentApp "core-api" $
      logStdoutDev $
        cors (const $ Just simpleCorsResourcePolicy {corsRequestHeaders = ["Content-Type"]})
        --  $ serve (Proxy :: Proxy (CoreAPI :<|> SwaggerSchemaUI "swagger-ui" "swagger.json")) $ (coreServer pool :<|> swaggerSchemaUIServer theDoc)
        $
          addPathsTo404 $ case flags_authMode of
            "PEM" -> case flags_stratoMode of
              "CLIENT" -> serve (Proxy :: Proxy (FullAPI :<|> SwaggerSchemaUI "swagger-ui" "swagger.json")) $
                hoistCoreServerProxyCore blocEnv urlMap :<|> swaggerSchemaUIServer theDoc
              _ -> serve (Proxy :: Proxy (FullAPI :<|> SwaggerSchemaUI "swagger-ui" "swagger.json")) $
                hoistCoreServer blocEnv urlMap :<|> swaggerSchemaUIServer theDoc
            _ -> case flags_stratoMode of
              "CLIENT" -> serve (Proxy :: Proxy (FullAPIOAuth :<|> SwaggerSchemaUI "swagger-ui" "swagger.json")) $
                hoistCoreServerOauthProxyCore blocEnv urlMap :<|> swaggerSchemaUIServer theDoc
              _ -> serve (Proxy :: Proxy (FullAPIOAuth :<|> SwaggerSchemaUI "swagger-ui" "swagger.json")) $
                hoistCoreServerOauth blocEnv urlMap :<|> swaggerSchemaUIServer theDoc

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
    allPaths = H.keys $ _swaggerPaths $ toSwagger (Proxy :: Proxy FullAPIExternal)

----------

-- Temporary location for a couple of instance definitions needed for toSwagger, we need to find a better place

instance HasSwagger a => HasSwagger (MultipartForm Mem (MultipartData Mem) :> a) where
  toSwagger _ = toSwagger (Proxy :: Proxy a)

instance ToSchema Value where
  declareNamedSchema _ =
    return $
      NamedSchema (Just "JSON Value") mempty

-----------
