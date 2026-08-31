{-# LANGUAGE BangPatterns #-}

-- Evaluation-only IR probe and kill switch. Not a consensus API.
module Blockchain.SolidVM.IREval
  ( IRFrameOutcome (..),
    IRMissWhy (..),
    irDisabledRef,
    irFrameDisabled,
    withNoIR,
    withIREval,
    seedIRDisabledFromFlags,
    irOutcomeCount,
    irOutcomeList,
    recordIRFrameOutcome,
  )
where

import Control.Monad (when)
import Control.Monad.IO.Class (MonadIO, liftIO)
import Data.IORef
import System.Environment (lookupEnv)
import System.IO.Unsafe (unsafePerformIO)
import UnliftIO (MonadUnliftIO)
import qualified UnliftIO as U

data IRMissWhy
  = WhyGuard
  | WhyNoLower
  | WhyArgLen
  | WhyNoIRFlag
  deriving (Eq, Show)

data IRFrameOutcome
  = IRHit {irFunc :: String, irCost :: Integer, irSkipThen :: Bool}
  | IRFallback {irFunc :: String}
  | IRMiss {irFunc :: String, irWhy :: IRMissWhy}
  deriving (Eq, Show)

{-# NOINLINE irDisabledRef #-}
irDisabledRef :: IORef Bool
irDisabledRef = unsafePerformIO $ do
  env <- lookupEnv "SOLIDVM_NO_IR"
  newIORef (env == Just "1" || env == Just "true")

-- Evaluation-only frame selector. A process may set SOLIDVM_IR_SKIP to a
-- comma/space-separated list of contract names, function names, or exact
-- Contract.function pairs. This lets state-root replay bisect a divergent IR
-- frame without disabling unrelated optimized calls.
{-# NOINLINE irSkipSelectors #-}
irSkipSelectors :: [String]
irSkipSelectors = unsafePerformIO $ do
  env <- lookupEnv "SOLIDVM_IR_SKIP"
  pure $ maybe [] (words . map (\c -> if c == ',' then ' ' else c)) env

irFrameDisabled :: String -> String -> Bool
irFrameDisabled contractName funcName =
  any (`elem` [contractName, funcName, contractName ++ "." ++ funcName]) irSkipSelectors

{-# NOINLINE irEvalOnRef #-}
irEvalOnRef :: IORef Bool
irEvalOnRef = unsafePerformIO $ newIORef False

{-# NOINLINE irOutcomesRef #-}
irOutcomesRef :: IORef [IRFrameOutcome]
irOutcomesRef = unsafePerformIO $ newIORef []

seedIRDisabledFromFlags :: Bool -> IO ()
seedIRDisabledFromFlags flag = when flag $ writeIORef irDisabledRef True

withNoIR :: MonadUnliftIO m => m a -> m a
withNoIR act = do
  old <- liftIO $ readIORef irDisabledRef
  liftIO $ writeIORef irDisabledRef True
  act `U.finally` liftIO (writeIORef irDisabledRef old)

withIREval :: MonadUnliftIO m => m a -> m (a, [IRFrameOutcome])
withIREval act = do
  oldOn <- liftIO $ readIORef irEvalOnRef
  liftIO $ writeIORef irEvalOnRef True
  liftIO $ writeIORef irOutcomesRef []
  a <- act `U.finally` liftIO (writeIORef irEvalOnRef oldOn)
  outs <- liftIO $ reverse <$> readIORef irOutcomesRef
  pure (a, outs)

irOutcomeCount :: IO Int
irOutcomeCount = length <$> readIORef irOutcomesRef

irOutcomeList :: IO [IRFrameOutcome]
irOutcomeList = reverse <$> readIORef irOutcomesRef

recordIRFrameOutcome :: MonadIO m => IRFrameOutcome -> m ()
recordIRFrameOutcome o = liftIO $ do
  on <- readIORef irEvalOnRef
  when on $ atomicModifyIORef' irOutcomesRef (\xs -> (o : xs, ()))
