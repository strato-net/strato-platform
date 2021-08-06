{-# LANGUAGE DeriveAnyClass             #-}
{-# LANGUAGE FlexibleContexts           #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE ImplicitParams             #-}
{-# LANGUAGE LambdaCase                 #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE RecordWildCards            #-}
{-# LANGUAGE ScopedTypeVariables        #-}
{-# LANGUAGE TemplateHaskell            #-}
{-# LANGUAGE TypeFamilies               #-}

module BlockApps.Bloc22.Monad (
  Bloc,
  BlocEnv(..),
  BlocError(..),
  blocError,
  Compile(..),
  Should(..),
  DeployMode(..),
  blocQuery,
  blocModify,
  blocModify1,
  blocQueryMaybe,
  runBlocToIO
  ) where


import           Control.Monad.Reader
import           Data.Cache
import           Data.Foldable
import           Data.Int                           (Int32)
import           Data.Pool (Pool, withResource)
import           Data.Profunctor.Product.Default
import           Data.Text                          (Text)
import qualified Data.Text                          as Text
import           Database.PostgreSQL.Simple         (Connection)
import           GHC.Stack
import           Network.HTTP.Client                hiding (responseBody)
import           Opaleye
import           Servant
import           Servant.Client
import           Text.Printf

import           UnliftIO                           hiding (Handler(..))

import           BlockApps.Logging
import           BlockApps.Solidity.Xabi
import           Blockchain.Strato.Model.CodePtr

data Should a = Don't a | Do a
data Compile = Compile

type Bloc = ReaderT BlocEnv (LoggingT IO)

blocError :: HasCallStack => BlocError -> Bloc y
blocError err = do
    logErrorCS callStack . Text.pack $
      printf "err: %s\nCallstack:%s" (show err) (prettyCallStack callStack)
    throwIO err

data DeployMode = Enterprise | Public deriving (Eq, Enum, Show, Ord)

data BlocEnv = BlocEnv
  { urlStrato          :: BaseUrl
  , urlVaultWrapper    :: BaseUrl
  , httpManager        :: Manager
  , dbPool             :: Pool Connection
  , deployMode         :: DeployMode
  , stateFetchLimit    :: Integer
  , globalCodePtrCache :: Cache CodePtr (Int32, ContractDetails)
  }

data BlocError
  = StratoError ClientError
  | CirrusError ServerError
  | VaultWrapperError ClientError
  | DBError Text
  | UserError Text
  | CouldNotFind Text
  | AnError Text
  | Unimplemented Text
  | AlreadyExists Text
  | RuntimeError SomeException
  | UnavailableError Text
  | InternalError Text
  deriving (Show, Exception)

--------------------------------------------------------------------------------

runBlocWithEnv :: BlocEnv -> Bloc a -> IO a
runBlocWithEnv env = runLoggingT
                   . flip runReaderT env

runBlocToIO :: BlocEnv -> Bloc a -> IO (Either BlocError a)
runBlocToIO env = try . runBlocWithEnv env


blocQuery
  :: (HasCallStack, Default Unpackspec x x, Default QueryRunner x y)
  => Query x
  -> Bloc [y]
blocQuery q = do
  traverse_ (logInfoCS callStack . Text.pack) (showSql q)
  pool <- asks dbPool
  withResource pool $ liftIO . flip runQuery q

blocQueryMaybe
  :: (HasCallStack, Default Unpackspec x x, Default QueryRunner x y)
  => Query x
  -> Bloc (Maybe y)
blocQueryMaybe q = blocQuery q >>= \case
    [] -> return Nothing
    [y] -> return (Just y)
    _:_:_ -> throwIO $ DBError "blocQueryMaybe: Multiple results, expected one row"


blocModify :: HasCallStack => (Connection -> IO x) -> Bloc x
blocModify modify = do
  logInfoCS callStack "Updating the database"
  pool <- asks dbPool
  withResource pool (liftIO . modify)

blocModify1 :: HasCallStack => (Connection -> IO [x]) -> Bloc x
blocModify1 modify = do
  logInfoCS callStack "Updating the database"
  results <- blocModify modify
  case results of
    []    -> throwIO $ DBError "No result, expected one row"
    [y]   -> return y
    _:_:_ -> throwIO $ DBError "Multiple results, expected one row"

