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
import           Control.Monad.Trans.Control
import           Control.Monad.Trans.Except
import           Control.Monad.Trans.Reader
import           Data.Aeson
import qualified Data.ByteString.Lazy.Char8      as BLC
import qualified Data.HashMap.Strict.InsOrd           as H
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




import           BlockApps.Bloc22.API
import           BlockApps.Bloc22.Monad          hiding (handleRuntimeError)
import           BlockApps.Bloc22.Server
import           BlockApps.Init

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
import           SQLM
import           UnliftIO                        hiding (Handler)

import           Control.Monad.Change.Modify
import           Control.Monad.Composable.BlocSQL

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

fullServer :: (MonadBaseControl IO m, MonadLogger m, HasSQL m, HasBlocSQL m, HasBlocEnv m,
               HasVault m, HasCoreAPI m) =>
              ServerT FullAPI m
fullServer = coreServer :<|> bloc

----------------

instance {-# OVERLAPPING #-} (Monad m) => Accessible a (ReaderT a m) where
  access _ = ask

instance (Monad m, Accessible a m, MonadTrans t) => Accessible a (t m) where
  access p = lift (access p)


hoistCoreServer :: Server FullAPI
hoistCoreServer = hoistServer (Proxy :: Proxy FullAPI) (convertErrors runM) fullServer
  where
    convertErrors r x = Handler $ do
      y <- liftIO . try . r $ x `catch` handleRuntimeError `catch` handleApiError
      case y of
        Right a -> pure a
        Left e -> throwE $ apiErrorToServantErr e
    runM = runLoggingT .
           runSQLM .
           flip runReaderT BlocEnv{
                            deployMode = error "deployMode undefined",
                            stateFetchLimit = error "stateFetchLimit undefined",
                            globalNonceCounter = error "globalNonceCounter undefined",
                            globalSourceCache = error "globalSourceCache undefined",
                            txTBQueue = error "txTBQueue undefined"
                            } .
           runBlocSQLM "postgres" 5432 "postgres" "api" .
           runVaultM "http://localhost" .
           runCoreAPIM "http://localhost"

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
  run 3001 $ app theDoc

app :: Swagger -> Application
app theDoc = 
  prometheus def{prometheusInstrumentApp = False}
  $ instrumentApp "core-api"
  $ logStdoutDev
  $ cors (const $ Just simpleCorsResourcePolicy{corsRequestHeaders=["Content-Type"]})
--  $ serve (Proxy :: Proxy (CoreAPI :<|> SwaggerSchemaUI "swagger-ui" "swagger.json")) $ (coreServer pool :<|> swaggerSchemaUIServer theDoc)
  $ serve (Proxy :: Proxy (FullAPI :<|> SwaggerSchemaUI "swagger-ui" "swagger.json" :<|> Raw))
  $ hoistCoreServer :<|> swaggerSchemaUIServer theDoc :<|> Tagged serveCustom404



serveCustom404 :: Application
serveCustom404 x respond =
  respond $ responseLBS notFound404 [("Content-Type", "text/plain")] $ BLC.pack
  $ "There is no content at: " ++ show (rawPathInfo x)
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
