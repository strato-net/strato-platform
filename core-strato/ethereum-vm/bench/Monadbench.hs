{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE RankNTypes #-}
{-# LANGUAGE MultiParamTypeClasses #-}

{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}
import Control.DeepSeq
import Control.Exception
import Control.Monad
import Control.Monad.Base
import Control.Monad.IO.Class
import Control.Monad.Trans.Except (ExceptT, runExceptT)
import Control.Monad.Error.Class
import Control.Monad.Trans.State (StateT, runStateT)
import qualified Control.Monad.Trans.State.Strict as ST
import Control.Monad.State.Class
import Control.Monad.Reader.Class
import Control.Monad.Logger
import Control.Monad.Trans.Resource

import GHC.Generics

import Criterion.Main

type VMM m = (MonadState FakeVMState m, MonadIO m, MonadLogger m, MonadResource m, MonadError FakeVMException m)
data FakeVMException = VMOops | VMOuch deriving (Show, Eq, Generic, NFData)

data FakeVMState = FakeVMState {
  pc :: Int
  , gasRemaining :: Int
} deriving (Show, Eq, Generic, NFData)

type Logger = Loc -> LogSource -> LogLevel -> LogStr -> IO ()
devNull :: Logger
devNull _ _ _ _ = return ()

initialState :: FakeVMState
initialState = FakeVMState 0 0x40000

data ResourceLogs = RL {
  resourceMap :: !InternalState, -- simulate ResourceT
  logger :: !Logger -- simulate LoggerT
}

gasProgram :: VMM m => m ()
gasProgram = forever $! do
  s0 <- get
  let s1 = s0 {pc = pc s0 + 1, gasRemaining = gasRemaining s0 - 1}
  put s1
  when (gasRemaining s1 < 0) $ do
    $logErrorS "program" "Out of gas!"
    throwError VMOops

-- Status quo
type StackVMM = ExceptT FakeVMException (StateT FakeVMState (ResourceT (LoggingT IO)))

runVMStack :: StackVMM a -> IO (Either FakeVMException a, FakeVMState)
runVMStack = flip runLoggingT devNull . runResourceT . flip runStateT initialState . runExceptT

-- Strict StateT
type StrictStackVMM = ExceptT FakeVMException (ST.StateT FakeVMState (ResourceT (LoggingT IO)))

runVMStrict :: StrictStackVMM a -> IO (Either FakeVMException a, FakeVMState)
runVMStrict = flip runLoggingT devNull . runResourceT . flip ST.runStateT initialState . runExceptT

-- CPS
runVMCPSReal :: VMCPS FakeVMState a -> IO (Either FakeVMException a, FakeVMState)
runVMCPSReal m = bracket createInternalState closeInternalState $ \is ->
  runVMCPS m is devNull initialState (\sf e -> return (Left e, sf)) (\sf x -> return (Right x, sf))

newtype VMCPS s a =
  VMCPS { runVMCPS :: forall r . InternalState
                              -> Logger
                              -> s
                              -> (s -> FakeVMException -> IO (r, s))
                              -> (s -> a -> IO (r, s))
                              -> IO (r, s)}

instance Monad (VMCPS s) where
  return x = VMCPS $ \_ _ st _ sk -> sk st x
  VMCPS m >>= f = VMCPS $ \is l st0 ek sk ->
    m is l st0 ek (\st1 x -> runVMCPS (f $! x) is l st1 ek sk)

instance Applicative (VMCPS s) where
  pure = return
  (<*>) = ap

instance Functor (VMCPS s) where
  fmap = liftM

instance MonadError FakeVMException (VMCPS s) where
  throwError e = VMCPS $ \_ _ st ek _ -> ek st e
  catchError (VMCPS m) handler = VMCPS $ \is l st0 ek sk ->
    m is l st0 (\st1 e -> runVMCPS (handler $! e) is l st1 ek sk) sk

instance MonadThrow (VMCPS s) where
  throwM = liftIO . throwIO

instance MonadIO (VMCPS s) where
  liftIO m = VMCPS $ \_ _ st _ sk -> do
    x <- m
    sk st $! x

instance MonadBase IO (VMCPS s) where
  liftBase = liftIO

instance MonadState s (VMCPS s) where
  get = VMCPS $ \_ _ st _ sk -> sk st $! st
  put st = VMCPS $ \_ _ _ _ sk -> sk st ()

instance MonadLogger (VMCPS s) where
  monadLoggerLog loc source level msg = VMCPS $ \_ l st _ sk -> do
    l loc source level $! toLogStr msg
    sk st ()

instance MonadResource (VMCPS s) where
  liftResourceT m = VMCPS $ \r _ st _ sk -> do
    a <- runInternalState m r
    sk st a

-- HandRolled

newtype VMRoll s a = VMRoll { run :: ResourceLogs -> s -> IO (Either FakeVMException a, s) }

runVMRoll :: VMRoll FakeVMState a -> IO (Either FakeVMException a, FakeVMState)
runVMRoll m = bracket createInternalState
                      closeInternalState
                      $ \istate -> run m (RL istate devNull) initialState

instance Monad (VMRoll s) where
  return !x = VMRoll $ \_ s -> return (Right x, s)
  (>>=) = bindVMRoll

{-# INLINE bindVMRoll #-}
bindVMRoll :: VMRoll s a -> (a -> VMRoll s b) -> VMRoll s b
bindVMRoll !m !f = VMRoll $ \r s0 -> do
  (res, s1) <- run m r s0
  case res of
    Left err -> return (Left err, s1)
    Right a -> run (f a) r s1

instance MonadState s (VMRoll s) where
  get = VMRoll $ \_ s -> return (Right s, s)
  put !s = VMRoll $ \_ _ -> return (Right (), s)

instance MonadReader ResourceLogs (VMRoll s) where
  ask = VMRoll $ \r s -> return (Right r, s)
  local !f !m = VMRoll $ \r s -> run m (f $! r) s

instance MonadError FakeVMException (VMRoll s) where
  {-# INLINE throwError #-}
  throwError !e = VMRoll $ \_ s -> return (Left e, s)
  {-# INLINE catchError #-}
  catchError !m !f = VMRoll $ \r s0 -> do
    res0 <- run m r s0
    case res0 of
      (Left e, s1) -> run (f $! e) r s1
      success -> return success

instance Functor (VMRoll s) where
  fmap = liftM

instance Applicative (VMRoll s) where
  pure = return
  (<*>) = ap

instance MonadIO (VMRoll s) where
  liftIO !a = VMRoll $ \_ s -> do
    x <- a
    return (Right x, s)

instance MonadBase IO (VMRoll s) where
  liftBase = liftIO

instance MonadThrow (VMRoll s) where
  throwM = liftIO . throwIO

instance MonadLoggerIO (VMRoll s) where
  askLoggerIO = asks logger

instance MonadLogger (VMRoll s) where
  monadLoggerLog loc source level msg = do
    l <- asks logger
    liftIO $! l loc source level $! toLogStr msg

instance MonadResource (VMRoll s) where
  liftResourceT m = do
    rmap <- asks resourceMap
    liftIO $! runInternalState m rmap

runGasBench :: VMM m => String
                     -> (m ()
                     -> IO (Either FakeVMException (), FakeVMState)) -> Benchmark
runGasBench name f = bench name . nfIO $ do
  res <- f gasProgram
  evaluate $! force res

main :: IO ()
main = defaultMain [ runGasBench "Transformer Stack" runVMStack
                   , runGasBench "Strict Transformer Stack" runVMStrict
                   , runGasBench "Continuation Passing Style" runVMCPSReal
                   , runGasBench "Handrolled" runVMRoll
                   ]
