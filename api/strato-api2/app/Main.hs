{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeOperators     #-}



{-# OPTIONS -fno-warn-orphans #-}

module Main where

import           Blockchain.Output
import           Control.Lens.Operators
import           Control.Monad.Reader            (MonadTrans, lift)
import           Control.Monad.Trans.Except
import           Control.Monad.Trans.Reader
import           Data.Aeson
import qualified Data.ByteString.Lazy.Char8      as BLC
import qualified Data.Cache                      as Cache
import qualified Data.HashMap.Strict.InsOrd      as H
import           Data.Proxy
import           Data.Swagger
import           HFlags
import           Network.HTTP.Types.Status
import           Network.Wai
import           Network.Wai.Handler.Warp
import           Network.Wai.Middleware.Cors
import           Network.Wai.Middleware.Prometheus
import           Network.Wai.Middleware.RequestLogger
import           Servant
import           Servant.Multipart
import           Servant.Swagger
import           Servant.Swagger.UI
import           System.Clock



import           BlockApps.Bloc22.API
import           BlockApps.Bloc22.Monad          -- hiding (handleRuntimeError)
import           BlockApps.Bloc22.Server
import           BlockApps.Init

import           Control.Monad.Composable.BlocSQL
import           Control.Monad.Composable.CoreAPI hiding (httpManager)
import           Control.Monad.Composable.SQL    hiding (SQLM)
import           Control.Monad.Composable.Vault  hiding (httpManager)

import           Text.Tools

import qualified Handlers.AccountInfo            as Account
import qualified Handlers.BatchTransactionResult as BatchTransactionResult
import qualified Handlers.BlkLast                as BlkLast
import qualified Handlers.Block                  as Block
import qualified Handlers.Chain                  as Chain
import qualified Handlers.Coinbase               as Coinbase
import qualified Handlers.Faucet                 as Faucet
import qualified Handlers.Log                    as Log
import qualified Handlers.Peers                  as Peers
import qualified Handlers.QueuedTransactions     as QueuedTransactions
import qualified Handlers.Stats                  as Stats
import qualified Handlers.Storage                as Storage
import qualified Handlers.Transaction            as Transaction
import qualified Handlers.TransactionResult      as TransactionResult
import qualified Handlers.TxLast                 as TxLast
import qualified Handlers.UUID                   as UUID
import qualified Handlers.Version                as Version
import           Options
import           SQLM
import           UnliftIO                        hiding (Handler)

import           Control.Monad.Change.Modify

type CoreAPI =
  "eth" :> "v1.2" :>
  (
    Account.API
    :<|> BatchTransactionResult.API
    :<|> BlkLast.API
    :<|> Block.API
    :<|> Chain.API
    :<|> Coinbase.API
    :<|> Faucet.API
    :<|> Log.API
    :<|> Peers.API
    :<|> QueuedTransactions.API
    :<|> Stats.API
    :<|> Storage.API
    :<|> Transaction.API
    :<|> TransactionResult.API
    :<|> TxLast.API
    :<|> UUID.API
    :<|> Version.API
  )

type FullAPI = CoreAPI :<|> "bloc" :> "v2.2" :> BlocAPI
  
coreServer :: (MonadLogger m, HasSQL m) => ServerT CoreAPI m
coreServer = Account.server
  :<|> BatchTransactionResult.server
  :<|> BlkLast.server
  :<|> Block.server
  :<|> Chain.server
  :<|> Coinbase.server
  :<|> Faucet.server
  :<|> Log.server
  :<|> Peers.server
  :<|> QueuedTransactions.server
  :<|> Stats.server
  :<|> Storage.server
  :<|> Transaction.server
  :<|> TransactionResult.server
  :<|> TxLast.server
  :<|> UUID.server
  :<|> Version.server

fullServer :: (MonadLogger m, HasSQL m, HasBlocSQL m, HasBlocEnv m, HasVault m, HasCoreAPI m) =>
              ServerT FullAPI m
fullServer = coreServer :<|> bloc

----------------

instance {-# OVERLAPPING #-} (Monad m) => Accessible a (ReaderT a m) where
  access _ = ask

instance (Monad m, Accessible a m, MonadTrans t) => Accessible a (t m) where
  access p = lift (access p)


hoistCoreServer :: BlocEnv -> SQLEnv -> BlocSQLEnv -> Server FullAPI
hoistCoreServer blocEnv sqlEnv blocSQLEnv = hoistServer (Proxy :: Proxy FullAPI) (convertErrors runM) fullServer
  where
    convertErrors r x = Handler $ do
      y <- liftIO . try . r $ x `catch` handleRuntimeError `catch` handleApiError
      case y of
        Right a -> pure a
        Left e -> throwE $ apiErrorToServantErr e
    runM f =
      runLoggingT .
        runSQLMUsingEnv sqlEnv .
        flip runReaderT blocEnv .
        runBlocSQLMUsingEnv blocSQLEnv .
        runVaultM "http://vault-wrapper:8000/strato/v2.3" .
        runCoreAPIM "http://strato:3000/eth/v1.2" $ f

fullAPI :: Proxy FullAPI
fullAPI = Proxy

main :: IO ()
main = do
  _ <- $initHFlags "Core API"
  let theDoc = toSwagger (Proxy :: Proxy FullAPI)
               & info.title .~ "Strato API"
               & info.description ?~
               "This is the great Strato API, which let's \
               \ you query the blockchain."
               & info.version .~ "1.2"

  --print theDoc
  blockappsInit "core-api"

  let stateFetchLimit'=100
      nonceCounterTimeout=10
      sourceCacheTimeout=60
      txQueueSize=4096
      
  nonceCache <- Cache.newCache . Just $ TimeSpec nonceCounterTimeout 0
  codePtrCache <- Cache.newCache . Just $ TimeSpec sourceCacheTimeout 0
  sourceCache <- Cache.newCache . Just $ TimeSpec sourceCacheTimeout 0
  tbqueue <- newTBQueueIO txQueueSize

  sqlEnv <- createSQLEnv
  blocSQLEnv <- createBlocSQLEnv "postgres" 5432 "postgres" "api"
  
  let env =
        BlocEnv{
          gasOn = flags_gasOn,
          stateFetchLimit = stateFetchLimit',
          globalNonceCounter = nonceCache,
          globalCodePtrCache = codePtrCache,
          globalSourceCache = sourceCache,
          txTBQueue = tbqueue
          }
  run 3000 $ app env sqlEnv blocSQLEnv theDoc

app :: BlocEnv -> SQLEnv -> BlocSQLEnv -> Swagger -> Application
app blocEnv sqlEnv blocSQLEnv theDoc = 
  prometheus def{prometheusInstrumentApp = False}
  $ instrumentApp "core-api"
  $ logStdoutDev
  $ cors (const $ Just simpleCorsResourcePolicy{corsRequestHeaders=["Content-Type"]})
--  $ serve (Proxy :: Proxy (CoreAPI :<|> SwaggerSchemaUI "swagger-ui" "swagger.json")) $ (coreServer pool :<|> swaggerSchemaUIServer theDoc)
  $ addPathsTo404
  $ serve (Proxy :: Proxy (FullAPI :<|> SwaggerSchemaUI "swagger-ui" "swagger.json"))
  $ hoistCoreServer blocEnv sqlEnv blocSQLEnv :<|> swaggerSchemaUIServer theDoc



addPathsTo404 :: Middleware
addPathsTo404 baseApp req respond =
  baseApp req $ \response -> do
    if responseStatus response /= status404
    then respond response
    else 
      respond $ responseLBS notFound404 [("Content-Type", "text/plain")] $ BLC.pack
        $ "There is no content at: " ++ show (rawPathInfo req)
        ++ "\nHere are the available routes:" ++ tab ("\n" ++ unlines allPaths) ++ "\n"
      where
        allPaths = H.keys $ _swaggerPaths $ toSwagger (Proxy :: Proxy FullAPI)


----------

--Temporary location for a couple of instance definitions needed for toSwagger, we need to find a better place

instance HasSwagger a => HasSwagger (MultipartForm Mem (MultipartData Mem) :> a) where
  toSwagger _ = toSwagger (Proxy :: Proxy a)

instance ToSchema Value where
  declareNamedSchema _ = return $
    NamedSchema (Just "JSON Value") mempty
