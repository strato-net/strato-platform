{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Debugger.Types
  ( module Data.Source,
    ParseError,
    Breakpoint (..),
    DebugOperation (..),
    VariableSet (..),
    VariableMap (..),
    WatchSet (..),
    WatchMap (..),
    DebugState (..),
    DebuggerStatus (..),
    DebugSettingsF (..),
    DebugSettings,
    DebugSettingsI,
    emptyDebugSettings,
    newDebugSettings,
    Debuggable,
    Evaluator,
    EvaluationRequest,
    EvaluationResponse,
    withoutDebugging,
    breakpoint,
    breakpointMatches,
    isBreakpoint,
    handleBreakpoint,
  )
where

import Control.DeepSeq
import Control.Monad
import qualified Control.Monad.Change.Modify as Mod
import Data.Aeson as Aeson
import Data.Foldable (for_)
import Data.Functor.Identity
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as M
import Data.Set (Set)
import qualified Data.Set as S
import Data.Source
import Data.Text (Text)
import Data.Traversable
import GHC.Generics
import Test.QuickCheck
import Test.QuickCheck.Instances.Text ()
import Text.Parsec (ParseError)
import UnliftIO hiding (assert)

data Breakpoint
  = UnconditionalBP SourcePosition
  | ConditionalBP SourcePosition Text -- TODO: should be Expression
  | DataBP Text -- TODO: should be Expression
  | FunctionBP Text -- function name
  | HitcountBP SourcePosition
  deriving (Eq, Ord, Show, Generic, NFData, ToJSON, FromJSON)

instance Arbitrary Breakpoint where
  arbitrary = do
    (i :: Int) <- choose (0, 4)
    case i of
      1 -> ConditionalBP <$> arbitrary <*> arbitrary
      2 -> DataBP <$> arbitrary
      3 -> FunctionBP <$> arbitrary
      4 -> HitcountBP <$> arbitrary
      _ -> UnconditionalBP <$> arbitrary

data DebugOperation
  = Run
  | Pause
  | StepIn
  | StepOver
  | StepOut
  deriving (Eq, Ord, Show, Generic, NFData, ToJSON, FromJSON)

instance Arbitrary DebugOperation where
  arbitrary = do
    (i :: Int) <- choose (0, 4)
    case i of
      1 -> pure Run
      2 -> pure Pause
      3 -> pure StepIn
      4 -> pure StepOver
      _ -> pure StepOut

newtype VariableSet = VariableSet (Map Text (Set Text))

newtype VariableMap = VariableMap (Map Text (Map Text EvaluationResponse))

newtype WatchSet = WatchSet (Set Text)

newtype WatchMap = WatchMap (Map Text EvaluationResponse)

data DebugState = DebugState
  { debugStateBreakpoint :: SourcePosition,
    debugStateCallStack :: [SourcePosition],
    debugStateVariables :: (Map Text (Map Text EvaluationResponse)),
    debugStateWatches :: (Map Text EvaluationResponse)
  }
  deriving (Eq, Ord, Show, Generic, NFData, ToJSON, FromJSON)

instance Arbitrary DebugState where
  arbitrary =
    DebugState
      <$> arbitrary
      <*> arbitrary
      <*> arbitrary
      <*> arbitrary

data DebuggerStatus
  = Running
  | Paused DebugState
  | Stepping !Int
  deriving (Eq, Ord, Show, Generic, ToJSON, FromJSON)

instance Arbitrary DebuggerStatus where
  arbitrary = do
    (i :: Int) <- choose (0, 2)
    case i of
      1 -> pure Running
      2 -> Stepping <$> arbitrary
      _ -> Paused <$> arbitrary

type EvaluationRequest = Text

type EvaluationResponse = Either Text Text

data DebugSettingsF tvar tchan tmvar = DebugSettings
  { operation :: tchan DebugOperation,
    requests :: tchan (tmvar EvaluationRequest, tmvar EvaluationResponse), -- request and response
    breakpoints :: tvar (Set Breakpoint),
    current :: tvar DebuggerStatus,
    exceptionBreakpoints :: tvar Bool,
    functionBreakpoints :: tvar Bool,
    watchExpressions :: tvar (Set Text),
    ping :: tmvar ()
  }
  deriving (Generic)

type DebugSettings = DebugSettingsF TVar TChan TMVar

type DebugSettingsI = DebugSettingsF Identity [] Maybe

instance NFData DebugSettings where
  rnf d@DebugSettings {} = d `seq` ()

emptyDebugSettings :: DebugSettingsI
emptyDebugSettings =
  DebugSettings
    []
    []
    (Identity S.empty)
    (Identity Running)
    (Identity False)
    (Identity False)
    (Identity S.empty)
    Nothing

newDebugSettings :: STM DebugSettings
newDebugSettings =
  let DebugSettings {..} = emptyDebugSettings
      tvar = newTVar . runIdentity
   in DebugSettings
        <$> newTChan
        <*> newTChan
        <*> (tvar breakpoints)
        <*> (tvar current)
        <*> (tvar exceptionBreakpoints)
        <*> (tvar functionBreakpoints)
        <*> (tvar watchExpressions)
        <*> newEmptyTMVar

type Debuggable m =
  ( MonadUnliftIO m,
    Mod.Modifiable (Maybe DebugSettings) m,
    Mod.Accessible [SourcePosition] m,
    Mod.Accessible VariableSet m
  )

type Evaluator m = EvaluationRequest -> m EvaluationResponse

withoutDebugging :: Debuggable m => m a -> m a
withoutDebugging f = do
  dSettings <- Mod.get (Mod.Proxy @(Maybe DebugSettings))
  Mod.put (Mod.Proxy @(Maybe DebugSettings)) Nothing
  a <- f
  Mod.put (Mod.Proxy @(Maybe DebugSettings)) dSettings
  pure a

breakpoint :: Debuggable m => Evaluator m -> m ()
breakpoint eval = do
  poss <- Mod.access (Mod.Proxy @[SourcePosition])
  case poss of
    [] -> do
      debugSettings <- Mod.get (Mod.Proxy @(Maybe DebugSettings))
      for_ debugSettings $ \d -> atomically $ writeTVar (current d) Running
    (pos : _) -> do
      isBreak <- isBreakpoint eval pos
      when isBreak $ handleBreakpoint eval pos

breakpointMatches ::
  Debuggable m =>
  Evaluator m ->
  SourcePosition ->
  Breakpoint ->
  m Bool
breakpointMatches eval pos = \case
  UnconditionalBP loc -> pure $ matchesLoc loc
  HitcountBP loc -> pure $ matchesLoc loc
  ConditionalBP loc exprText ->
    if not (matchesLoc loc)
      then pure False
      else runCond exprText
  DataBP exprText -> runCond exprText
  FunctionBP _ -> pure False -- TODO
  where
    matchesLoc loc =
      let eqOn f a b = f a == f b
          fMatch = eqOn _sourcePositionName pos loc
          lMatch = eqOn _sourcePositionLine pos loc
       in fMatch && lMatch
    runCond exprText = do
      val <- withoutDebugging $ eval exprText
      case val of
        Right "True" -> pure True
        Right "true" -> pure True
        _ -> pure False

isBreakpoint ::
  Debuggable m =>
  Evaluator m ->
  SourcePosition ->
  m Bool
isBreakpoint eval pos = do
  debugSettings <- Mod.get (Mod.Proxy @(Maybe DebugSettings))
  case debugSettings of
    Nothing -> pure False
    Just DebugSettings {..} -> do
      state <- atomically $ readTVar current
      if state == Running
        then do
          bPoints <- fmap S.toList . atomically $ readTVar breakpoints
          matchedBP <- or <$> traverse (breakpointMatches eval pos) bPoints
          if matchedBP
            then pure True
            else pure False
        else pure True

handleBreakpoint ::
  Debuggable m =>
  Evaluator m ->
  SourcePosition ->
  m ()
handleBreakpoint eval pos = do
  debugSettings <- Mod.get (Mod.Proxy @(Maybe DebugSettings))
  for_ debugSettings loop
  where
    loop d@DebugSettings {..} = do
      state <- atomically $ readTVar current
      case state of
        Stepping n -> do
          cStack <- Mod.access (Mod.Proxy @[SourcePosition])
          let cLen = length cStack
          if cLen == 0
            then void . atomically $ writeTVar current Running
            else unless (cLen >= n) $ void (atomically $ writeTVar current Running) >> loop d -- Set to running to trigger doPause on next loop
        _ -> do
          eCmd <- doPause >> race evalLoop (atomically $ readTChan operation)
          case eCmd of
            Right Run -> void . atomically $ writeTVar current Running
            Right StepIn -> step 2
            Right StepOver -> step 1
            Right StepOut -> step 0
            _ -> loop d
      where
        step k = do
          n <- length <$> Mod.access (Mod.Proxy @[SourcePosition])
          void . atomically . writeTVar current . Stepping $ n + k
        evalLoop = forever $ do
          (req, res) <- atomically $ readTChan requests
          expr <- atomically $ takeTMVar req
          resp <- withoutDebugging $ eval expr
          atomically $ putTMVar res resp

        doPause = do
          cStack <- Mod.access (Mod.Proxy @[SourcePosition])
          watchExprs <- fmap S.toList . atomically $ readTVar watchExpressions
          watchVals <- traverse (withoutDebugging . eval) watchExprs
          let watchValsMap = M.fromList $ zip watchExprs watchVals
          VariableSet varSet <- Mod.access (Mod.Proxy @VariableSet)
          varMap <- for varSet $ traverse (withoutDebugging . eval) . M.fromSet id
          void . atomically . writeTVar current . Paused $ DebugState pos cStack varMap watchValsMap
          void . atomically $ tryPutTMVar ping ()
