{-# LANGUAGE FlexibleInstances    #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE ConstraintKinds      #-}
{-# LANGUAGE TemplateHaskell      #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Foundation where

import           Control.Monad.Change.Modify (Accessible(..))
import           Database.Persist.Sql     (ConnectionPool, runSqlPool)
import           Import.NoFoundation
import qualified Data.ByteString.Char8    as BC
import qualified Data.Text                as T
import qualified Data.Text.Encoding       as T
import qualified Data.Text.Encoding.Error as T
import           Data.Time
import qualified Network.Wai              as W
import qualified Prelude                  as P
import           Yesod.Core.Types         (Logger)

import           Network.Haskoin.Crypto   as HK
import           Blockchain.DB.SQLDB
import           Blockchain.Strato.Model.SHA

timeFormat :: String
timeFormat = "%Y-%m-%dT%T.%q"

stringToDate :: Text -> UTCTime
stringToDate s = time where
    time  = parseTimeOrError True defaultTimeLocale timeFormat picos
    picos = P.init (T.unpack s) ++ replicate 9 '0'

instance PathPiece UTCTime where
    toPathPiece t = T.pack $ show t
    fromPathPiece = Just . stringToDate


-- | The foundation datatype for your application. This can be a good place to
-- keep settings and values requiring initialization before your application
-- starts running, such as database connections. Every handler will have
-- access to the data present here.
data App = App
    { appSettings    :: AppSettings
    , appConnPool    :: ConnectionPool -- ^ Database connection pool.
    , appHttpManager :: Manager
    , appLogger      :: Logger
    , appFaucetNonce :: IORef Integer -- The last maximum nonce given out
    , appFaucetKey   :: Maybe HK.PrvKey
    }

getKey :: HandlerFor App (Maybe HK.PrvKey)
getKey = appFaucetKey <$> getYesod

initialMaxNonce :: MonadIO m => m (IORef Integer)
initialMaxNonce = liftIO $ newIORef (-1)

acquireNewMaxNonce :: (MonadReader App m, MonadIO m) => Integer -> m Integer
acquireNewMaxNonce minNonce = do
  let findNext :: Integer -> (Integer, Integer)
      -- Another node may have jumped ahead of our faucet stream or we may
      -- just be starting up, so always give at least the minNonce.
      findNext maxNonce =
        let next = 1 + max minNonce maxNonce
        in (next, next)
  nref <- asks appFaucetNonce
  liftIO $ atomicModifyIORef' nref findNext

instance HasHttpManager App where
    getHttpManager = appHttpManager

-- This is where we define all of the routes in our application. For a full
-- explanation of the syntax, please see:
-- http://www.yesodweb.com/book/routing-and-handlers
--
--
--
-- Note that this is really half the story; in Application.hs, mkYesodDispatch
-- generates the rest of the code. Please see the linked documentation for an
-- explanation for this split.

mkYesodData "App" $(parseRoutesFile "config/routes.txt")

-- Please see the documentation for the Yesod typeclass. There are a number
-- of settings which can be configured by overriding methods here.
instance Yesod App where

    errorHandler NotFound = do
                     r <- waiRequest
                     let path' = T.decodeUtf8With T.lenientDecode $ W.rawPathInfo r
                     return $ toTypedContent $ "Invalid path: " `T.append` path' `T.append` "\n"
    errorHandler (InternalError msg) =
        return $ toTypedContent $ "Internal Error:\n" `T.append` msg `T.append` "\n"
    errorHandler (InvalidArgs ia) =
        return $ toTypedContent $ "Invalid Arguments\n" `T.append` T.intercalate "\n  -" ia `T.append` "\n"
    errorHandler (BadMethod m) =
        return $ toTypedContent $ "Unsupported Method: " ++ BC.unpack m ++ "\n"
    errorHandler (PermissionDenied msg) =
        return $ toTypedContent $ "Permission Denied: " `T.append` msg `T.append` "\n"
    errorHandler other = defaultErrorHandler other

    -- Controls the base of generated URLs. For more information on modifying,
    -- see: https://github.com/yesodweb/yesod/wiki/Overriding-approot
    approot = ApprootMaster $ appRoot . appSettings

    maximumContentLength _ _ = Just (4 * 1024 * 1024 :: Word64) -- 4M

    shouldLogIO app _source level = return $
        appShouldLogAll (appSettings app)
            || level == LevelWarn
            || level == LevelError

    makeLogger = return . appLogger

instance Accessible SQLDB (HandlerFor App) where
  access _ = appConnPool <$> getYesod

instance YesodPersist App where
    type YesodPersistBackend App = SqlBackend
    runDB action = do
        master <- getYesod
        runSqlPool action $ appConnPool master

instance YesodPersistRunner App where
    getDBRunner = defaultGetDBRunner appConnPool

-- This instance is required to use forms. You can modify renderMessage to
-- achieve customized and internationalized form validation messages.
instance RenderMessage App FormMessage where
    renderMessage _ _ = defaultFormMessage
