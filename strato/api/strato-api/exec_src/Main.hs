{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
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
import Control.Monad.Change.Modify (Accessible)
import Control.Monad.Composable.Identity
import Control.Monad.Composable.SQL
import Control.Monad.Composable.Vault hiding (httpManager)
import Control.Monad.Trans.Class
import Control.Monad.Trans.Except
import Control.Monad.Trans.Maybe
import Control.Monad.Trans.Reader
import Data.Aeson
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy.Char8 as BLC
import qualified Data.Cache as Cache
import qualified Data.HashMap.Strict.InsOrd as H
import Data.Map (fromList, traverseWithKey)
import Data.Maybe (fromJust, isJust, listToMaybe, maybeToList)
import Data.Source.Map
import Data.Swagger hiding (Http, delete)
import HFlags
import qualified Handlers.AccountInfo as Account
import qualified Handlers.BatchTransactionResult as BatchTransactionResult
import qualified Handlers.BlkLast as BlkLast
import qualified Handlers.Block as Block
import qualified Handlers.Faucet as Faucet
import qualified Handlers.IdentityServerCallback as Identity
import qualified Handlers.Metadata as Metadata
import Handlers.Options
import qualified Handlers.Peers as Peers
import qualified Handlers.QueuedTransactions as QueuedTransactions
import qualified Handlers.Stats as Stats
import qualified Handlers.Storage as Storage
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
import Servant.Client.Core hiding (requestMethod)
import Servant.Multipart
import Servant.Swagger
import Servant.Swagger.UI
import SolidVM.Model.CodeCollection.Contract
import System.Clock
import Text.Regex
import Text.Tools
import UnliftIO hiding (Handler)
import Prelude hiding (lookup)

instance {-# OVERLAPPING #-} MonadUnliftIO m => Selectable Account Contract (SQLM m) where
  select _ a = runMaybeT $ do
    (AddressStateRef' r _) <-
      MaybeT
        . fmap listToMaybe
        . Account.getAccount'
        $ Account.accountsFilterParams
          & Account.qaAddress ?~ (a ^. accountAddress)
          & Account.qaChainId .~ (fmap ChainId . maybeToList $ a ^. accountChainId)
    codePtr <- MaybeT . pure $ addressStateRefCodePtr r
    MaybeT $ either (const Nothing) (Just . snd) <$> getContractDetailsByCodeHash codePtr

instance Selectable Account Contract m => Selectable Account Contract (ReaderT a m) where
  select p = lift . select p

instance {-# OVERLAPPING #-} MonadUnliftIO m => (Keccak256 `Selectable` SourceMap) (SQLM m) where
  select _ = Account.getCodeFromPostgres

instance (Keccak256 `Selectable` SourceMap) m => (Keccak256 `Selectable` SourceMap) (ReaderT a m) where
  select p = lift . select p

instance {-# OVERLAPPING #-} MonadUnliftIO m => (Keccak256 `Alters` DBCode) (SQLM m) where
  lookup _ k = fmap (SolidVM,) <$> Account.getCodeByteStringFromPostgres k
  insert _ _ _ = error "API: Keccak256 `Alters` DBCode insert"
  delete _ _ = error "API: Keccak256 `Alters` DBCode delete"

instance (Keccak256 `Alters` DBCode) m => (Keccak256 `Alters` DBCode) (ReaderT a m) where
  lookup p = lift . lookup p
  insert p k = lift . insert p k
  delete p = lift . delete p

instance {-# OVERLAPPING #-} MonadUnliftIO m => Selectable Account AddressState (SQLM m) where
  select _ a = runMaybeT $ do
    (AddressStateRef' r _) <-
      MaybeT
        . fmap listToMaybe
        . Account.getAccount'
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

instance Selectable Account AddressState m => Selectable Account AddressState (ReaderT a m) where
  select p = lift . select p

instance {-# OVERLAPPING #-} MonadUnliftIO m => Selectable Address Certificate (CirrusM m) where
  select _ = Account.getX509CertForAccount

instance Selectable Address Certificate m => Selectable Address Certificate (ReaderT a m) where
  select p = lift . select p

type CoreAPI =
  "eth" :> "v1.2"
    :> ( Account.API
           :<|> Account.CodeAPI
           :<|> BatchTransactionResult.API
           :<|> BlkLast.API
           :<|> Block.API
           :<|> Faucet.API
           :<|> Identity.API
           :<|> Metadata.API
           :<|> Peers.API
           :<|> QueuedTransactions.API
           :<|> Stats.API
           :<|> Storage.API
           :<|> Transaction.API
           :<|> TransactionResult.API
           :<|> TxLast.API
       )

type FullAPI = CoreAPI :<|> "bloc" :> "v2.2" :> BlocAPI

coreServer ::
  ( MonadLogger m,
    HasSQL m,
    Accessible Metadata.UrlMap m,
    Accessible IdentityData m,
    Accessible VaultData m,
    Selectable Keccak256 SourceMap m
  ) =>
  ServerT CoreAPI m
coreServer =
  Account.server
    :<|> Account.codeServer
    :<|> BatchTransactionResult.server
    :<|> BlkLast.server
    :<|> Block.server
    :<|> Faucet.server
    :<|> Identity.server
    :<|> Metadata.server
    :<|> Peers.server
    :<|> QueuedTransactions.server
    :<|> Stats.server
    :<|> Storage.server
    :<|> Transaction.server flags_txSizeLimit
    :<|> TransactionResult.server
    :<|> TxLast.server

fullServer ::
  ( MonadLogger m,
    HasSQL m,
    HasBlocEnv m,
    HasIdentity m,
    HasVault m,
    Accessible Metadata.UrlMap m,
    Selectable Account Contract m,
    Selectable Account AddressState m,
    Selectable Address Certificate m,
    HasCodeDB m,
    Selectable Keccak256 SourceMap m
  ) =>
  ServerT FullAPI m
fullServer = coreServer :<|> bloc

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
        . runVaultM ("http://localhost:8013/strato/v2.3")
        . runIdentitytM getIdentityServerUrl
        $ f

fullAPI :: Proxy FullAPI
fullAPI = Proxy

main :: IO ()
main = do
  _ <- $initHFlags "Core API"

  -- check if id server connection is valid; only run if using https (unless using localhost)
  identityUrl <- parseBaseUrl getIdentityServerUrl
  let allowedIPAddressRegex = "^172.17.((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\\.){1}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])$"
  let matches = matchRegex (mkRegex allowedIPAddressRegex) (baseUrlHost identityUrl)
  if baseUrlScheme identityUrl == Http && not (isJust matches || baseUrlHost identityUrl == "docker.for.mac.localhost")
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
