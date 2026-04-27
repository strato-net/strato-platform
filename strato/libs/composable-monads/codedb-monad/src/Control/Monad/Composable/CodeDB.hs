{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeOperators #-}

module Control.Monad.Composable.CodeDB
  ( CodeDBM,
    HasCodeDBAccess,
    runCodeDBM,
    lookupCodeCollection,
  )
where

import BlockApps.Logging (runNoLoggingT)
import Blockchain.DB.CodeDB (DBCode)
import Blockchain.DB.SQLDB (SQLDB (..))
import Blockchain.Data.AddressStateDB (AddressState)
import Blockchain.Data.DataDefs (CodeRef (..), EntityField (..))
import Blockchain.EthConf (connStr)
import Blockchain.SolidVM.CodeCollectionDB (codeCollectionFromHash)
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.Keccak256 (Keccak256)
import qualified Control.Monad.Change.Alter as A
import Control.Monad.Composable.Base
import Control.Monad.IO.Class
import Control.Monad.IO.Unlift
import Control.Monad.Reader
import Control.Monad.Trans.Resource (ResourceT, runResourceT)
import Control.Exception (try, SomeException)
import Data.IORef
import Data.Maybe (listToMaybe)
import Data.Text (Text)
import qualified Data.Text.Encoding as Text
import qualified Database.Esqueleto.Legacy as E
import qualified Database.Persist.Postgresql as PSQL
import qualified Database.Persist.Sql as SQL
import SolidVM.Model.CodeCollection (CodeCollection)
import System.IO.Unsafe (unsafePerformIO)

newtype CodeDBEnv = CodeDBEnv {codeDBPool :: SQLDB}

type CodeDBM = ReaderT CodeDBEnv

type HasCodeDBAccess m = (MonadIO m, MonadUnliftIO m, AccessibleEnv CodeDBEnv m)

instance {-# OVERLAPPING #-} Monad m => AccessibleEnv SQLDB (ReaderT CodeDBEnv m) where
  accessEnv = asks codeDBPool

instance {-# OVERLAPPING #-} (Keccak256 `A.Alters` DBCode) (ReaderT CodeDBEnv IO) where
  lookup _ k = fmap (fmap Text.encodeUtf8) $ lookupCode k
  insert _ _ _ = error "CodeDB monad: insert not supported"
  delete _ _ = error "CodeDB monad: delete not supported"

instance {-# OVERLAPPING #-} A.Selectable FilePath (Either String String) (ReaderT CodeDBEnv IO) where
  select _ _ = pure Nothing

instance {-# OVERLAPPING #-} A.Selectable Address AddressState (ReaderT CodeDBEnv IO) where
  select _ _ = pure Nothing

globalCodeDBEnv :: IORef CodeDBEnv
globalCodeDBEnv = unsafePerformIO $ do
  pool <- runNoLoggingT $ PSQL.createPostgresqlPool connStr 5
  newIORef $ CodeDBEnv (SQLDB pool)
{-# NOINLINE globalCodeDBEnv #-}

runCodeDBM :: MonadIO m => CodeDBM IO a -> m a
runCodeDBM f = liftIO $ do
  env <- readIORef globalCodeDBEnv
  runReaderT f env

codeDBQuery :: HasCodeDBAccess m => SQL.SqlPersistT (ResourceT m) a -> m a
codeDBQuery q = do
  env <- accessEnv
  runResourceT $ SQL.runSqlPool q (unSQLDB $ codeDBPool env)

lookupCode :: HasCodeDBAccess m => Keccak256 -> m (Maybe Text)
lookupCode cHash =
  fmap (listToMaybe . map (codeRefCode . E.entityVal)) . codeDBQuery . E.select $
    E.from $ \codeRef -> do
      E.where_ (codeRef E.^. CodeRefCodeHash E.==. E.val cHash)
      return codeRef

lookupCodeCollection :: Keccak256 -> CodeDBM IO (Maybe CodeCollection)
lookupCodeCollection cHash = do
  result <- liftIO . try $ runReaderT (codeCollectionFromHash False False cHash) =<< readIORef globalCodeDBEnv
  case result of
    Right cc -> return (Just cc)
    Left (_ :: SomeException) -> return Nothing
