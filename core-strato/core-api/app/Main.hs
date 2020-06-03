{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeOperators     #-}



{-# OPTIONS -fno-warn-orphans #-}

module Main where

import           Blockchain.Output
import           Control.Lens.Operators
import           Control.Monad.Trans.Except
import           Data.Aeson
import qualified Data.ByteString.Lazy.Char8      as BLC
import qualified Data.HashMap.Strict.InsOrd           as H
import           Data.Proxy
import           Data.Swagger
import           Database.Persist.Postgresql
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




import           BlockApps.Init
import           Blockchain.EthConf

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
  
coreServer :: ServerT CoreAPI SQLM
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

----------------

enterCoreServer  :: ConnectionPool -> SQLM a -> Handler a
enterCoreServer pool x = Handler $ do
  y <- liftIO . try . runSQLM pool $ x `catch` handleRuntimeError `catch` handleApiError
  case y of
    Right a -> pure a
    Left e -> throwE e

hoistCoreServer :: ConnectionPool -> Server CoreAPI
hoistCoreServer pool = hoistServer (Proxy :: Proxy CoreAPI) (enterCoreServer pool) coreServer


coreAPI :: Proxy CoreAPI
coreAPI = Proxy

main :: IO ()
main = do
  _ <- $initHFlags "Core API"
  let theDoc = toSwagger (Proxy :: Proxy CoreAPI)
               & info.title .~ "Strato API"
               & info.description ?~
               "This is the great Strato API, which let's \
               \ you query the blockchain."
               & info.version .~ "1.2"

  --print theDoc
  blockappsInit "core-api"
  pool <- runNoLoggingT $ createPostgresqlPool connStr 20
  run 3000 $ app pool theDoc

app :: ConnectionPool -> Swagger -> Application
app pool theDoc = 
  prometheus def{prometheusInstrumentApp = False}
  $ instrumentApp "core-api"
  $ logStdoutDev
  $ cors (const $ Just simpleCorsResourcePolicy{corsRequestHeaders=["Content-Type"]})
--  $ serve (Proxy :: Proxy (CoreAPI :<|> SwaggerSchemaUI "swagger-ui" "swagger.json")) $ (coreServer pool :<|> swaggerSchemaUIServer theDoc)
  $ serve (Proxy :: Proxy (CoreAPI :<|> SwaggerSchemaUI "swagger-ui" "swagger.json" :<|> Raw))
  $ hoistCoreServer pool :<|> swaggerSchemaUIServer theDoc :<|> Tagged serveCustom404



serveCustom404 :: Application
serveCustom404 x respond =
  respond $ responseLBS notFound404 [("Content-Type", "text/plain")] $ BLC.pack
  $ "There is no content at: " ++ show (rawPathInfo x)
  ++ "\nHere are the available routes:" ++ tab ("\n" ++ unlines allPaths) ++ "\n"
  where
    allPaths = H.keys $ _swaggerPaths $ toSwagger (Proxy :: Proxy CoreAPI)


----------

--Temporary location for a couple of instance definitions needed for toSwagger, we need to find a better place

instance HasSwagger a => HasSwagger (MultipartForm Mem (MultipartData Mem) :> a) where
  toSwagger _ = toSwagger (Proxy :: Proxy a)

instance ToSchema Value where
  declareNamedSchema _ = return $
    NamedSchema (Just "JSON Value") mempty
