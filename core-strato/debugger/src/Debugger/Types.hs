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
  ( module Text.Parsec.Pos
  , ParseError
  , Breakpoint(..)
  , DebugOperation(..)
  , VariableSet(..)
  , VariableMap(..)
  , WatchSet(..)
  , WatchMap(..)
  , DebugState(..)
  , DebuggerStatus(..)
  , DebugSettingsF(..)
  , DebugSettings
  , DebugSettingsI
  , emptyDebugSettings
  , newDebugSettings
  , Debuggable
  , Evaluator
  , EvaluationRequest
  , EvaluationResponse
  , withoutDebugging
  , breakpoint
  , breakpointMatches
  , isBreakpoint
  , handleBreakpoint
  ) where

import           Control.DeepSeq
import           Control.Monad
import           Control.Monad.FT
import           Control.Monad.IO.Class
import           Data.Aeson                           as Aeson
import           Data.Foldable                        (for_)
import           Data.Functor.Identity
import           Data.Map.Strict                      (Map)
import qualified Data.Map.Strict                      as M
import           Data.Set                             (Set)
import qualified Data.Set                             as S
import           Data.Text                            (Text)
import qualified Data.Text                            as T
import           Data.Traversable
import           GHC.Generics
import           Text.Parsec                          (ParseError)
import           Text.Parsec.Pos
import           Test.QuickCheck

import           UnliftIO                             hiding (assert)

instance Arbitrary Text where
  arbitrary = T.pack <$> arbitrary

instance NFData SourcePos where
  rnf pos = pos `seq` ()

instance Arbitrary SourcePos where
  arbitrary = newPos <$> arbitrary <*> arbitrary <*> arbitrary

instance ToJSON SourcePos where
  toJSON pos = object [
    "name" .= sourceName pos,
    "line" .= sourceLine pos,
    "column" .= sourceColumn pos
    ]

instance FromJSON SourcePos where
  parseJSON (Object o) = do
    name <- o .: "name"
    line <- o .: "line"
    column <- o .: "column"
    pure $ newPos name line column
  parseJSON o = fail $ "parseJSON SourcePos: expected Object, got " ++ show o

data Breakpoint = UnconditionalBP SourcePos
                | ConditionalBP SourcePos Text -- TODO: should be Expression
                | DataBP Text -- TODO: should be Expression
                | FunctionBP Text -- function name
                | HitcountBP SourcePos
                deriving (Eq, Ord, Show, Generic, NFData, ToJSON, FromJSON)

instance Arbitrary Breakpoint where
  arbitrary = do
    (i :: Int) <- choose (0,4)
    case i of
      1 -> ConditionalBP <$> arbitrary <*> arbitrary
      2 -> DataBP <$> arbitrary
      3 -> FunctionBP <$> arbitrary
      4 -> HitcountBP <$> arbitrary
      _ -> UnconditionalBP <$> arbitrary

data DebugOperation = Run
                    | Pause
                    | StepIn
                    | StepOver
                    | StepOut
                    deriving (Eq, Ord, Show, Generic, NFData, ToJSON, FromJSON)

instance Arbitrary DebugOperation where
  arbitrary = do
    (i :: Int) <- choose (0,4)
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
  { debugStateBreakpoint :: SourcePos
  , debugStateCallStack  :: [SourcePos]
  , debugStateVariables  :: (Map Text (Map Text EvaluationResponse))
  , debugStateWatches    :: (Map Text EvaluationResponse)
  } deriving (Eq, Ord, Show, Generic, NFData, ToJSON, FromJSON)

instance Arbitrary DebugState where
  arbitrary = DebugState
          <$> arbitrary
          <*> arbitrary
          <*> arbitrary
          <*> arbitrary

data DebuggerStatus = Running
                    | Paused DebugState
                    | Stepping !Int
                    deriving (Eq, Ord, Show, Generic, ToJSON, FromJSON)

instance Arbitrary DebuggerStatus where
  arbitrary = do
    (i :: Int) <- choose (0,2)
    case i of
      1 -> pure Running
      2 -> Stepping <$> arbitrary
      _ -> Paused <$> arbitrary

type EvaluationRequest = Text
type EvaluationResponse = Either Text Text

data DebugSettingsF tvar tchan tmvar = DebugSettings
  { operation :: tchan DebugOperation
  , requests :: tchan (tmvar EvaluationRequest, tmvar EvaluationResponse) -- request and response
  , breakpoints :: tvar (Set Breakpoint)
  , current :: tvar DebuggerStatus
  , exceptionBreakpoints :: tvar Bool
  , functionBreakpoints :: tvar Bool
  , watchExpressions :: tvar (Set Text)
  , ping :: tmvar ()
  } deriving (Generic)

type DebugSettings = DebugSettingsF TVar TChan TMVar
type DebugSettingsI = DebugSettingsF Identity [] Maybe

instance NFData DebugSettings where
  rnf d@DebugSettings{..} = d `seq` ()

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
  let DebugSettings{..} = emptyDebugSettings
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
  ( MonadIO m
  , Modifiable (Maybe DebugSettings) m
  , Gettable [SourcePos] m
  , Gettable VariableSet m
  )

type Evaluator m = EvaluationRequest -> m EvaluationResponse

withoutDebugging :: Debuggable m => m a -> m a
withoutDebugging f = do
  dSettings <- get @(Maybe DebugSettings)
  put @(Maybe DebugSettings) Nothing
  a <- f
  put @(Maybe DebugSettings) dSettings
  pure a

breakpoint :: Debuggable m => Evaluator m -> m ()
breakpoint eval = do
  poss <- get @[SourcePos]
  case poss of
    [] -> pure ()
    (pos:_) -> do
      isBreak <- isBreakpoint eval pos
      when isBreak $ handleBreakpoint eval pos

breakpointMatches :: Debuggable m
                  => Evaluator m
                  -> SourcePos
                  -> Breakpoint
                  -> m Bool
breakpointMatches eval pos = \case
  UnconditionalBP loc -> pure $ matchesLoc loc
  HitcountBP loc -> pure $ matchesLoc loc
  ConditionalBP loc exprText -> if not (matchesLoc loc)
    then pure False
    else runCond exprText
  DataBP exprText -> runCond exprText
  FunctionBP _ -> pure False -- TODO
  where matchesLoc loc = let eqOn f a b = f a == f b
                             fMatch = eqOn sourceName pos loc
                             lMatch = eqOn sourceLine pos loc
                          in fMatch && lMatch
        runCond exprText = do
          val <- withoutDebugging $ eval exprText
          case val of
            Right "True" -> pure True
            Right "true" -> pure True
            _ -> pure False

isBreakpoint :: Debuggable m
             => Evaluator m
             -> SourcePos
             -> m Bool
isBreakpoint eval pos = do
  debugSettings <- get @(Maybe DebugSettings)
  case debugSettings of
    Nothing -> pure False
    Just DebugSettings{..} -> do
      state <- atomically $ readTVar current
      if state == Running
        then do
          bPoints <- fmap S.toList . atomically $ readTVar breakpoints
          matchedBP <- or <$> traverse (breakpointMatches eval pos) bPoints
          if matchedBP
            then pure True
            else pure False
        else pure True

handleBreakpoint :: Debuggable m
                 => Evaluator m
                 -> SourcePos
                 -> m ()
handleBreakpoint eval pos = do
  debugSettings <- get @(Maybe DebugSettings)
  for_ debugSettings $ loop True
  where
    loop sendPing d@DebugSettings{..} = do
      evalLoop
      stateAndOp <- atomically $ (,) <$> readTVar current <*> tryReadTChan operation
      case stateAndOp of
        (_, Just Run) -> void . atomically $ writeTVar current Running
        (_, Just StepIn) -> step 2
        (_, Just StepOver) -> step 1
        (_, Just StepOut) -> step 0
        (Stepping n, _) -> do
          cStack <- get @[SourcePos]
          unless (length cStack >= n) $ doPause >> loop False d
        _ -> doPause >> loop False d
      where step k = do
              n <- length <$> get @[SourcePos]
              void . atomically . writeTVar current . Stepping $ n + k
            evalLoop = do
              mReq <- atomically $ tryReadTChan requests
              for_ mReq $ \(req, res) -> do
                mExpr <- atomically $ tryTakeTMVar req
                for_ mExpr $ \expr -> do
                  resp <- withoutDebugging $ eval expr
                  atomically $ putTMVar res resp
                evalLoop

            doPause = do
              cStack <- get @[SourcePos]
              watchExprs <- fmap S.toList . atomically $ readTVar watchExpressions
              watchVals <- traverse (withoutDebugging . eval) watchExprs
              let watchValsMap = M.fromList $ zip watchExprs watchVals
              VariableSet varSet <- get @VariableSet
              varMap <- for varSet $ traverse (withoutDebugging . eval) . M.fromSet id
              void . atomically . writeTVar current . Paused $ DebugState pos cStack varMap watchValsMap
              when sendPing . void . atomically $ tryPutTMVar ping ()