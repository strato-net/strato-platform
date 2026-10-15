{-# LANGUAGE AllowAmbiguousTypes #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DerivingVia #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE KindSignatures #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE RankNTypes #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE UndecidableInstances #-}

-- | The composable monads, as a flat effect monad.
--
-- @Eff es a@ is @Env es -> IO a@, where @Env es@ is a type-indexed record with
-- one statically typed field per environment type in the row @es@. A
-- composable monad such as @SQLM@ is one field; running it ('provide') adds
-- the field; a constraint such as @AccessibleEnv SQLDB m@ is satisfied for
-- @m ~ Eff es@ whenever @SQLDB@ is in @es@ and reads it by field selection.
--
-- The 'Monad' instance is exactly @ReaderT (Env es) IO@, deliberately
-- without 'GHC.Exts.oneShot': the environment lambda must stay floatable so
-- that environment-independent work in front of it is shared across
-- applications of the resulting action.
module Control.Monad.Composable.Base
  ( -- * The monad
    Eff (..),
    Env (..),
    (:>) (..),
    runEff,
    provide,
    localEnv,
    withEnv,

    -- * Environments
    AccessibleEnv (..),
    accessEnvVar,

    -- * Logging
    Logger,
    withLogger,
    withStderrLogger,
    withStdoutLogger,
    withNoLogger,

    -- * Resources
    withResources,
    InternalState,
    MonadResource,

    -- * State
    StateCell (..),
    withState,
    runStateEff,
    evalStateEff,
    execStateEff,

    -- * ReaderEnv
    ReaderEnv (..),
    withReaderEnv,
  )
where

import Control.Monad.Catch (MonadCatch (..), MonadMask (..), MonadThrow (..), bracket)
import qualified Control.Monad.Change.Modify as Mod
import Control.Monad.Fix (MonadFix)
import Control.Monad.IO.Class (MonadIO (..))
import Control.Monad.IO.Unlift (MonadUnliftIO (..))
import Control.Monad.Logger (Loc, LogLevel, LogSource, LogStr, MonadLogger (..), MonadLoggerIO (..), defaultOutput, toLogStr)
import Control.Monad.Primitive (PrimMonad (..), PrimState, RealWorld)
import Control.Monad.Reader (MonadReader (..), MonadTrans (..), ReaderT (..))
import Control.Monad.State (MonadState (..))
import Control.Monad.Trans.Resource (MonadResource (..), InternalState, closeInternalState, createInternalState, runInternalState)
import Data.IORef (IORef, atomicModifyIORef', newIORef, readIORef, writeIORef)
import Data.Kind (Type)
import System.IO (stderr, stdout)

-- ---------------------------------------------------------------------------
-- The monad

data Env (es :: [Type]) where
  Nil :: Env '[]
  (:&) :: !e -> !(Env es) -> Env (e ': es)

infixr 5 :&

-- | @e :> es@: the environment type @e@ is a field of the row @es@.
class e :> (es :: [Type]) where
  getEnv :: Env es -> e
  putEnv :: e -> Env es -> Env es

instance {-# OVERLAPPING #-} e :> (e ': es) where
  getEnv (r :& _) = r
  {-# INLINE getEnv #-}
  putEnv r (_ :& rest) = r :& rest
  {-# INLINE putEnv #-}

instance (e :> es) => e :> (x ': es) where
  getEnv (_ :& rest) = getEnv @e rest
  {-# INLINE getEnv #-}
  putEnv r (x :& rest) = x :& putEnv r rest
  {-# INLINE putEnv #-}

newtype Eff (es :: [Type]) a = Eff {unEff :: Env es -> IO a}
  deriving (Functor, Applicative, Monad, MonadFix, MonadIO, MonadThrow, MonadCatch, MonadMask, MonadUnliftIO) via ReaderT (Env es) IO

instance MonadFail (Eff es) where
  fail = liftIO . fail

instance PrimMonad (Eff es) where
  type PrimState (Eff es) = RealWorld
  primitive = liftIO . primitive
  {-# INLINE primitive #-}

runEff :: Eff '[] a -> IO a
runEff (Eff m) = m Nil
{-# INLINE runEff #-}

-- | Run an action that needs one more environment than the surrounding one:
-- the flat counterpart of @runReaderT@ for a transformer layer.
provide :: e -> Eff (e ': es) a -> Eff es a
provide e (Eff m) = Eff $ \env -> m (e :& env)
{-# INLINE provide #-}

localEnv :: forall e es a. (e :> es) => (e -> e) -> Eff es a -> Eff es a
localEnv f (Eff m) = Eff $ \env -> m (putEnv (f (getEnv @e env)) env)
{-# INLINE localEnv #-}

-- | Run an action in a smaller row by projecting the current environment.
withEnv :: (Env es -> Env es') -> Eff es' a -> Eff es a
withEnv f (Eff m) = Eff (m . f)
{-# INLINE withEnv #-}

-- ---------------------------------------------------------------------------
-- Environments

class AccessibleEnv a f where
  accessEnv :: f a

instance (a :> es) => AccessibleEnv a (Eff es) where
  accessEnv = Eff (pure . getEnv @a)
  {-# INLINE accessEnv #-}

-- | Transformers layered locally over 'Eff' (a 'ConduitT', a 'StateT') see
-- the environments underneath them.
instance (Monad m, AccessibleEnv a m, MonadTrans t) => AccessibleEnv a (t m) where
  accessEnv = lift accessEnv

instance (a :> es) => Mod.Accessible a (Eff es) where
  access _ = Eff (pure . getEnv @a)
  {-# INLINE access #-}

accessEnvVar ::
  (Monad m, AccessibleEnv a m) =>
  (a -> b) ->
  m b
accessEnvVar f = do
  env <- accessEnv
  return $ f env

-- ---------------------------------------------------------------------------
-- Logging: the flat counterpart of @LoggingT@.

newtype Logger = Logger (Loc -> LogSource -> LogLevel -> LogStr -> IO ())

instance (Logger :> es) => MonadLogger (Eff es) where
  monadLoggerLog loc src lvl msg = Eff $ \env -> case getEnv env of
    Logger l -> l loc src lvl (toLogStr msg)
  {-# INLINE monadLoggerLog #-}

instance (Logger :> es) => MonadLoggerIO (Eff es) where
  askLoggerIO = Eff $ \env -> case getEnv env of Logger l -> pure l
  {-# INLINE askLoggerIO #-}

withLogger :: (Loc -> LogSource -> LogLevel -> LogStr -> IO ()) -> Eff (Logger ': es) a -> Eff es a
withLogger = provide . Logger
{-# INLINE withLogger #-}

withStderrLogger :: Eff (Logger ': es) a -> Eff es a
withStderrLogger = withLogger (defaultOutput stderr)

withStdoutLogger :: Eff (Logger ': es) a -> Eff es a
withStdoutLogger = withLogger (defaultOutput stdout)

withNoLogger :: Eff (Logger ': es) a -> Eff es a
withNoLogger = withLogger (\_ _ _ _ -> pure ())

-- ---------------------------------------------------------------------------
-- Resources: the flat counterpart of @ResourceT@.

instance (InternalState :> es) => MonadResource (Eff es) where
  liftResourceT r = Eff $ \env -> runInternalState r (getEnv env)
  {-# INLINE liftResourceT #-}

withResources :: Eff (InternalState ': es) a -> Eff es a
withResources m = bracket (liftIO createInternalState) (liftIO . closeInternalState) (`provide` m)

-- ---------------------------------------------------------------------------
-- State: the flat counterpart of @StateT@, backed by an 'IORef'.

newtype StateCell s = StateCell (IORef s)

-- | The state type of a row: that of its first 'StateCell' (the functional
-- dependency of 'MonadState' needs the row to determine it).
type family StateOf (es :: [Type]) :: Type where
  StateOf (StateCell s ': _) = s
  StateOf (_ ': es) = StateOf es

instance (s ~ StateOf es, StateCell s :> es) => MonadState s (Eff es) where
  get = Eff $ \env -> case getEnv env of StateCell r -> readIORef r
  {-# INLINE get #-}
  put s = Eff $ \env -> case getEnv env of StateCell r -> writeIORef r s
  {-# INLINE put #-}
  state f = Eff $ \env -> case getEnv env of StateCell r -> atomicModifyIORef' r (\s -> let (a, s') = f s in (s', a))
  {-# INLINE state #-}

withState :: IORef s -> Eff (StateCell s ': es) a -> Eff es a
withState = provide . StateCell
{-# INLINE withState #-}

runStateEff :: s -> Eff (StateCell s ': es) a -> Eff es (a, s)
runStateEff s0 m = do
  r <- liftIO (newIORef s0)
  a <- withState r m
  s <- liftIO (readIORef r)
  pure (a, s)

evalStateEff :: s -> Eff (StateCell s ': es) a -> Eff es a
evalStateEff s0 m = fst <$> runStateEff s0 m

execStateEff :: s -> Eff (StateCell s ': es) a -> Eff es s
execStateEff s0 m = snd <$> runStateEff s0 m

-- ---------------------------------------------------------------------------
-- ReaderEnv: the flat counterpart of a @ReaderT r@ layer for code that uses
-- 'ask' / 'asks' / 'local' rather than 'accessEnv'.

newtype ReaderEnv r = ReaderEnv r

type family ReaderOf (es :: [Type]) :: Type where
  ReaderOf (ReaderEnv r ': _) = r
  ReaderOf (_ ': es) = ReaderOf es

instance (r ~ ReaderOf es, ReaderEnv r :> es) => MonadReader r (Eff es) where
  ask = Eff $ \env -> case getEnv env of ReaderEnv r -> pure r
  {-# INLINE ask #-}
  local f = localEnv (\(ReaderEnv r) -> ReaderEnv (f r))
  {-# INLINE local #-}

withReaderEnv :: r -> Eff (ReaderEnv r ': es) a -> Eff es a
withReaderEnv = provide . ReaderEnv
{-# INLINE withReaderEnv #-}
