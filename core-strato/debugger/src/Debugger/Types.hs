{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}
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
  , DebugSettings(..)
  , newDebugSettings
  , Debuggable
  , Evaluator
  , withoutDebugging
  , breakpoint
  , breakpointMatches
  , isBreakpoint
  , handleBreakpoint
  ) where

import           Control.DeepSeq
import           Control.Monad
import qualified Control.Monad.Change.Modify          as Mod
import           Control.Monad.IO.Class
import           Data.Aeson                           as Aeson
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
                deriving (Eq, Ord, Show, Generic, NFData, ToJSON, FromJSON)

instance Arbitrary Breakpoint where
  arbitrary = do
    (i :: Int) <- choose (0,3)
    case i of
      1 -> ConditionalBP <$> arbitrary <*> arbitrary
      2 -> DataBP <$> arbitrary
      3 -> FunctionBP <$> arbitrary
      _ -> UnconditionalBP <$> arbitrary

data DebugOperation = Run
                    | Pause
                    | StepIn
                    | StepOver {-# UNPACK #-} !Int
                    | InStepOver {-# UNPACK #-} !Int
                    | StepOut {-# UNPACK #-} !Int
                    | InStepOut {-# UNPACK #-} !Int
                    deriving (Eq, Ord, Show, Generic, NFData, ToJSON, FromJSON)

instance Arbitrary DebugOperation where
  arbitrary = do
    (i :: Int) <- choose (0,6)
    case i of
      1 -> pure Run
      2 -> pure Pause
      3 -> pure StepIn
      4 -> StepOver <$> arbitrary
      5 -> InStepOver <$> arbitrary
      6 -> StepOut <$> arbitrary
      _ -> InStepOut <$> arbitrary

newtype VariableSet = VariableSet (Map Text (Set Text))
newtype VariableMap = VariableMap (Map Text (Map Text Text))
newtype WatchSet = WatchSet (Set Text)
newtype WatchMap = WatchMap (Map Text Text)

data DebugState = DebugState
  { debugStateBreakpoint :: SourcePos
  , debugStateCallStack  :: [SourcePos]
  , debugStateVariables  :: (Map Text (Map Text Text))
  , debugStateWatches    :: (Map Text Text)
  } deriving (Eq, Ord, Show, Generic, NFData, ToJSON, FromJSON)

instance Arbitrary DebugState where
  arbitrary = DebugState
          <$> arbitrary
          <*> arbitrary
          <*> arbitrary
          <*> arbitrary

data DebuggerStatus = Running
                    | Paused DebugState
                    deriving (Eq, Ord, Show, Generic, ToJSON, FromJSON)

instance Arbitrary DebuggerStatus where
  arbitrary = do
    (i :: Int) <- choose (0,1)
    case i of
      1 -> pure Running
      _ -> Paused <$> arbitrary

data DebugSettings = DebugSettings {
                     operation :: TVar DebugOperation
                   , breakpoints :: TVar (Set Breakpoint)
                   , current :: TVar (Maybe DebugState)
                   , changed :: TVar Bool
                   , exceptionBreakpoints :: TVar Bool
                   , functionBreakpoints :: TVar Bool
                   , watchExpressions :: TVar (Set Text)
                   } deriving (Eq, Generic)

instance NFData DebugSettings where
  rnf d@DebugSettings{..} = d `seq` ()

newDebugSettings :: STM DebugSettings
newDebugSettings = DebugSettings
               <$> (newTVar Run)
               <*> (newTVar S.empty)
               <*> (newTVar Nothing)
               <*> (newTVar False)
               <*> (newTVar False)
               <*> (newTVar False)
               <*> (newTVar S.empty)

type Debuggable m =
  ( MonadIO m
  , Mod.Modifiable (Maybe DebugSettings) m
  , Mod.Accessible [SourcePos] m
  , Mod.Accessible VariableSet m
  )

type Evaluator m = Text -> m (Either ParseError Text)

withoutDebugging :: Debuggable m => m a -> m a
withoutDebugging f = do
  dSettings <- Mod.get (Mod.Proxy @(Maybe DebugSettings))
  Mod.put (Mod.Proxy @(Maybe DebugSettings)) Nothing
  a <- f
  Mod.put (Mod.Proxy @(Maybe DebugSettings)) dSettings
  pure a

breakpoint :: Debuggable m => Evaluator m -> m ()
breakpoint eval = do
  poss <- Mod.access (Mod.Proxy @[SourcePos])
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
          val <- eval exprText
          case val of
            Right "True" -> pure True
            Right "true" -> pure True
            _ -> pure False

isBreakpoint :: Debuggable m
             => Evaluator m
             -> SourcePos
             -> m Bool
isBreakpoint eval pos = do
  debugSettings <- Mod.get (Mod.Proxy @(Maybe DebugSettings))
  case debugSettings of
    Nothing -> pure False
    Just DebugSettings{..} -> do
      currentOperation <- atomically $ readTVar operation
      if currentOperation == Run
        then do
          bPoints <- fmap S.toList . atomically $ readTVar breakpoints
          matchedBP <- or <$> traverse (breakpointMatches eval pos) bPoints
          if matchedBP
            then atomically $ do
              writeTVar changed True
              writeTVar operation Pause
              pure True
            else pure False
        else pure True

handleBreakpoint :: Debuggable m
                 => Evaluator m
                 -> SourcePos
                 -> m ()
handleBreakpoint eval pos = do
  debugSettings <- Mod.get (Mod.Proxy @(Maybe DebugSettings))
  case debugSettings of
    Nothing -> pure ()
    Just DebugSettings{..} -> do
      cStack <- Mod.access (Mod.Proxy @[SourcePos])
      watchExprs <- fmap S.toList . atomically $ readTVar watchExpressions
      watchVals <- traverse (fmap (either (T.pack . show) id) . withoutDebugging . eval) watchExprs
      let watchValsMap = M.fromList $ zip watchExprs watchVals
      VariableSet varSet <- Mod.access (Mod.Proxy @VariableSet)
      varMap <- for varSet $ traverse (fmap (either (T.pack . show) id) . withoutDebugging . eval) . M.fromSet id
      void . atomically . writeTVar current . Just $ DebugState pos cStack varMap watchValsMap
      atomically $ do
        currentOperation <- readTVar operation
        case currentOperation of
          Run -> pure ()
          Pause -> retrySTM
          StepIn -> writeTVar operation Pause
          StepOver n -> writeTVar operation (InStepOver n)
          InStepOver n -> when (length cStack <= n) retrySTM
          StepOut n -> writeTVar operation (InStepOut n)
          InStepOut n -> when (length cStack < n) retrySTM
