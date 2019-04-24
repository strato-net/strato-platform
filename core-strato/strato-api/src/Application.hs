{-# LANGUAGE LambdaCase #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE TemplateHaskell #-}
module Application
    ( appMain
    , makeFoundation
    , makeLogware
    ) where


import           Control.Monad.Except
import           Blockchain.Output
import qualified Data.Binary                          as BN
import qualified Data.ByteString.Lazy                 as BL
import qualified Data.ByteString.Base64               as B64
import qualified Data.ByteString.Char8                as C8
import           Data.Either.Extra
import           Database.Persist.Postgresql
import qualified Database.PostgreSQL.Simple           as PG

import           Import
import           Language.Haskell.TH.Syntax           (qLocation)
import           Network.Wai (Middleware)
import           Network.Wai.Handler.Warp             (Settings, defaultSettings,
                                                       defaultShouldDisplayException,
                                                       setHost, setOnException, setPort)
import           Network.Wai.Handler.WarpTLS
import           Network.Wai.Middleware.RequestLogger (Destination (Logger), IPAddrSource (..),
                                                       OutputFormat (..), destination,
                                                       mkRequestLogger, outputFormat)
import           Network.Wai.Middleware.Prometheus
import           System.Environment
import           System.Exit
import           System.Log.FastLogger                (defaultBufSize, newStdoutLoggerSet)

import           Handler.AccountInfo
import           Handler.BatchTransactionResult
import           Handler.BlkLast
import           Handler.BlockInfo
import           Handler.ChainInfo
import           Handler.Coinbase
import           Handler.Common
import           Handler.Faucet
import           Handler.LogInfo
import           Handler.Peers
import           Handler.QueuedTransactions
import           Handler.Stats
import           Handler.StorageInfo
import           Handler.TransactionInfo
import           Handler.TransactionResult
import           Handler.TxLast
import           Handler.UUIDInfo

import           Blockchain.EthConf
import           Blockchain.Strato.Model.Address
import qualified Network.Haskoin.Crypto as HK
import           Text.Format

mkYesodDispatch "App" resourcesApp

-- | This function allocates resources (such as a database connection pool),
-- performs initialization and return a foundation datatype value. This is also
-- the place to put your migrate statements to have automatic database
-- migrations handled by Yesod.
makeFoundation :: AppSettings -> Maybe HK.PrvKey -> IO App
makeFoundation appSettings appFaucetKey = do
    -- Some basic initializations: HTTP connection manager and logger

    appHttpManager <- newManager
    appLogger <- newStdoutLoggerSet defaultBufSize >>= makeYesodLogger
    appFaucetNonce <- initialMaxNonce

    -- We need a log function to create a connection pool. We need a connection
    -- pool to create our foundation. And we need our foundation to get a
    -- logging function. To get out of this loop, we initially create a
    -- temporary foundation without a real connection pool, get a log function
    -- from there, and then create the real foundation.
    let mkFoundation appConnPool = App {..}
--        tempFoundation = mkFoundation $ error "connPool forced in tempFoundation"
--        logFunc = messageLoggerSource tempFoundation appLogger

    -- Create the database connection pool
    pool <- runNoLoggingT $ myPool
        (pgConnStr  $ appDatabaseConf appSettings)
        (pgPoolSize $ appDatabaseConf appSettings)

    -- Perform database migration using our application's logging settings.
    --runLoggingT (runSqlPool (runMigration migrateAll) pool) logFunc
    _ <- runNoLoggingT (runSqlPool (runMigrationSilent migrateAll) pool) --runMigration

    -- Return the foundation
    return $ mkFoundation pool

makeLogware :: App -> IO Middleware
makeLogware foundation =
    mkRequestLogger def
        { outputFormat =
            if appDetailedRequestLogging $ appSettings foundation
                then Detailed True
                else Apache
                        (if appIpFromHeader $ appSettings foundation
                            then FromFallback
                            else FromSocket)
        , destination = Logger $ loggerSet $ appLogger foundation
        }

noPool :: PG.Connection -> IO ()
noPool = const $ return ()

myPool :: (MonadLogger m, MonadIO m, MonadUnliftIO m)
       => ConnectionString -> Int -> m ConnectionPool
myPool = createPostgresqlPoolModified $ noPool


-- | Convert our foundation to a WAI Application by calling @toWaiAppPlain@ and
-- applyng some additional middlewares.
makeApplication :: App -> IO Application
makeApplication foundation = do
    logWare <- makeLogware foundation
    -- Create the WAI application and apply middlewares
    app <- toWaiApp foundation
    return $ prometheus def $ logWare $ defaultMiddlewaresNoLogging app

-- | Warp settings for the given foundation value.
warpSettings :: App -> Settings
warpSettings foundation =
      setPort (appPort $ appSettings foundation)
    $ setHost (appHost $ appSettings foundation)
    $ setOnException (\_req e ->
        when (defaultShouldDisplayException e) $ messageLoggerSource
            foundation
            (appLogger foundation)
            $(qLocation >>= liftLoc)
            "yesod"
            LevelError
            (toLogStr $ "Exception from Warp: " ++ show e))
      defaultSettings

getGlobalKey :: IO (Maybe HK.PrvKey)
getGlobalKey = fmap (HK.makePrvKey . BN.decode . BL.fromStrict) . readFile $ "config" </> "priv"

getLocalKey :: IO (Maybe HK.PrvKey)
getLocalKey = eitherExtractNodeKey >>= \case
  Left "NODEKEY not set" -> return Nothing
  Left err -> die err
  Right prvKey -> return $ Just prvKey

eitherExtractNodeKey :: IO (Either String HK.PrvKey)
eitherExtractNodeKey = runExceptT $ do
  mKey <- liftEither =<< maybeToEither "NODEKEY not set" <$> liftIO (lookupEnv "NODEKEY")
  when (null mKey) $
    throwError "NODEKEY not set"
  bytes <- liftEither . B64.decode . C8.pack $ mKey
  liftEither . maybeToEither "Invalid NODEKEY" . HK.decodePrvKey HK.makePrvKey $ bytes


-- | The @main@ function for an executable running this site.
appMain :: IO ()
appMain = do
    localKey <- getLocalKey
    globalKey <- getGlobalKey
    faucetKey <- case (localKey, globalKey) of
      (Just k, _) -> do
        putStrLn $ "Using local faucet: " <> pack (format (prvKey2Address k))
        return localKey
      (_, Just k) -> do
        putStrLn $ "Using global faucet: " <> pack (format (prvKey2Address k))
        return globalKey
      _ -> do
        putStrLn "No faucet key found; faucets are disabled"
        return Nothing

    -- Get the settings from all relevant sources
    settings <- loadYamlSettingsArgs
        -- fall back to compile-time values, set to [] to require values at runtime
        [configSettingsYmlValue]

        -- allow environment variables to override
        useEnv

  {- CONFIG gradual change -}

    let oldDbSettings = appDatabaseConf settings
        settings' = settings {
                      appDatabaseConf = oldDbSettings {
                        pgConnStr = connStr
                    }
                  }
    -- Generate the foundation from the settings
    foundation <- makeFoundation settings' faucetKey

    -- Generate a WAI Application from the foundation
    app <- makeApplication foundation

    -- Run the application with Warp
    -- runSettings (warpSettings foundation) app
    runTLS tls (warpSettings foundation) app
  where
    tls = (tlsSettingsChain "certs/star_blockapps_net.pem" ["certs/TrustedRoot.pem", "certs/DigiCertCA2.pem"] "certs/key.pem"){onInsecure=AllowInsecure}
