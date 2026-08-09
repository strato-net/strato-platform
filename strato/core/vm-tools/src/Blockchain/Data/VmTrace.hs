{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

-- | Structured execution traces for the strato_* simulation/trace JSON-RPC
-- endpoints (strato_traceCall, strato_traceTransaction, strato_traceBlock*).
--
-- Distinct from "CallTrace" in the ethereum-jsonrpc package, which builds a
-- shallow attribution frame from a finished TransactionResult. This is the live
-- tracer used during sandboxed re-execution: SolidVM is a source interpreter,
-- so the trace is a geth callTracer-style call-frame tree (built from CallInfo
-- push/pop) rather than an opcode log, with optional statement-level entries
-- carrying source positions.
--
-- The accumulator is an IORef so a trace survives the exception path: when a
-- call reverts, runSM unwinds, but every frame recorded up to that point is
-- still in the tracer.
module Blockchain.Data.VmTrace
  ( CallType (..),
    TraceLog (..),
    StatementEntry (..),
    CallFrame (..),
    VmTracer (..),
    newVmTracer,
    traceEnterFrame,
    traceExitFrame,
    traceSetLastOutput,
    traceAddLog,
    traceStatement,
    takeTraceRoots,
  )
where

import Blockchain.Strato.Model.Address (Address)
import Control.DeepSeq (NFData (..))
import Control.Monad.IO.Class (MonadIO, liftIO)
import Data.Aeson ((.=))
import qualified Data.Aeson as Aeson
import qualified Data.Aeson.Key as Key
import Data.IORef
import Data.Maybe (catMaybes)
import Data.Text (Text)
import qualified Data.Text as T

data CallType = CTCall | CTStaticCall | CTDelegateCall | CTCreate
  deriving (Show, Eq)

callTypeText :: CallType -> Text
callTypeText CTCall = "CALL"
callTypeText CTStaticCall = "STATICCALL"
callTypeText CTDelegateCall = "DELEGATECALL"
callTypeText CTCreate = "CREATE"

-- | A SolidVM event attached to the frame that emitted it. SolidVM events are
-- named with named args; there are no EVM-style topics.
data TraceLog = TraceLog
  { tlAddress :: Address,
    tlName :: Text,
    tlArgs :: [(Text, Text)]
  }
  deriving (Show, Eq)

instance Aeson.ToJSON TraceLog where
  toJSON TraceLog {..} =
    Aeson.object
      [ "address" .= T.pack (show tlAddress),
        "name" .= tlName,
        "args" .= Aeson.object [Key.fromText n .= v | (n, v) <- tlArgs]
      ]

-- | One executed statement (opt-in via TraceOptions.traceStatements).
data StatementEntry = StatementEntry
  { seSource :: Text,
    seLine :: Int,
    seColumn :: Int,
    seDepth :: Int,
    seGasLeft :: Integer
  }
  deriving (Show, Eq)

instance Aeson.ToJSON StatementEntry where
  toJSON StatementEntry {..} =
    Aeson.object
      [ "source" .= seSource,
        "line" .= seLine,
        "column" .= seColumn,
        "depth" .= seDepth,
        "gasLeft" .= seGasLeft
      ]

-- | A completed call frame, serialized with geth callTracer keys plus SolidVM
-- extensions (contract, function, args, statements).
data CallFrame = CallFrame
  { cfType :: CallType,
    cfFrom :: Address,
    cfTo :: Address,
    cfContract :: Text,
    cfFunction :: Text,
    cfArgs :: [Text],
    cfGas :: Integer,
    cfGasUsed :: Integer,
    cfOutput :: Maybe Text,
    cfError :: Maybe Text,
    cfLogs :: [TraceLog],
    cfCalls :: [CallFrame],
    cfStatements :: [StatementEntry]
  }
  deriving (Show, Eq)

instance Aeson.ToJSON CallFrame where
  toJSON CallFrame {..} =
    Aeson.object $
      catMaybes
        [ Just $ "type" .= callTypeText cfType,
          Just $ "from" .= T.pack (show cfFrom),
          Just $ "to" .= T.pack (show cfTo),
          Just $ "contract" .= cfContract,
          Just $ "function" .= cfFunction,
          Just $ "args" .= cfArgs,
          Just $ "gas" .= cfGas,
          Just $ "gasUsed" .= cfGasUsed,
          ("output" .=) <$> cfOutput,
          ("error" .=) <$> cfError,
          if null cfLogs then Nothing else Just $ "logs" .= cfLogs,
          if null cfCalls then Nothing else Just $ "calls" .= cfCalls,
          if null cfStatements then Nothing else Just $ "statements" .= cfStatements
        ]

-- An open frame; children/logs/statements accumulate in reverse order.
data PendingFrame = PendingFrame
  { pfType :: CallType,
    pfFrom :: Address,
    pfTo :: Address,
    pfContract :: Text,
    pfFunction :: Text,
    pfArgs :: [Text],
    pfGas :: Integer,
    pfLogs :: [TraceLog],
    pfCalls :: [CallFrame],
    pfStatements :: [StatementEntry]
  }

data TraceState = TraceState
  { tsStack :: [PendingFrame],
    tsRoots :: [CallFrame],
    tsStatements :: Bool,
    tsStatementCount :: Int,
    tsTruncated :: Bool
  }

-- | Statement entries across the whole trace are capped to keep responses
-- within Kafka message limits; the trace is marked truncated beyond this.
maxStatements :: Int
maxStatements = 50000

newtype VmTracer = VmTracer (IORef TraceState)

instance Show VmTracer where
  show _ = "<VmTracer>"

instance NFData VmTracer where
  rnf t = t `seq` ()

newVmTracer :: MonadIO m => Bool -> m VmTracer
newVmTracer statements =
  VmTracer <$> liftIO (newIORef (TraceState [] [] statements 0 False))

onTracer :: MonadIO m => Maybe VmTracer -> (TraceState -> TraceState) -> m ()
onTracer Nothing _ = pure ()
onTracer (Just (VmTracer ref)) f = liftIO $ atomicModifyIORef' ref $ \ts -> (f ts, ())

traceEnterFrame ::
  MonadIO m =>
  Maybe VmTracer ->
  CallType ->
  Address ->
  Address ->
  Text ->
  Text ->
  [Text] ->
  Integer ->
  m ()
traceEnterFrame mt ct from to contract fn args gas =
  onTracer mt $ \ts ->
    ts {tsStack = PendingFrame ct from to contract fn args gas [] [] [] : tsStack ts}

-- | Close the innermost open frame. A Just error marks the frame (and is set
-- on every unwinding frame as exceptions propagate). Zero-work CREATE frames
-- are dropped: SolidVM's create' pushes a bookkeeping "constructor" frame with
-- an empty body before the real constructor runs, and it carries no
-- information.
traceExitFrame :: MonadIO m => Maybe VmTracer -> Integer -> Maybe Text -> m ()
traceExitFrame mt gasLeft mErr =
  onTracer mt $ \ts -> case tsStack ts of
    [] -> ts
    (pf : rest) ->
      let frame =
            CallFrame
              { cfType = pfType pf,
                cfFrom = pfFrom pf,
                cfTo = pfTo pf,
                cfContract = pfContract pf,
                cfFunction = pfFunction pf,
                cfArgs = pfArgs pf,
                cfGas = pfGas pf,
                cfGasUsed = max 0 (pfGas pf - gasLeft),
                cfOutput = Nothing,
                cfError = mErr,
                cfLogs = reverse (pfLogs pf),
                cfCalls = reverse (pfCalls pf),
                cfStatements = reverse (pfStatements pf)
              }
          isNoise =
            cfType frame == CTCreate
              && cfGasUsed frame == 0
              && null (cfCalls frame)
              && null (cfLogs frame)
              && null (cfStatements frame)
              && cfError frame == Nothing
       in if isNoise
            then ts {tsStack = rest}
            else case rest of
              (parent : rest') -> ts {tsStack = parent {pfCalls = frame : pfCalls parent} : rest'}
              [] -> ts {tsStack = [], tsRoots = frame : tsRoots ts}

-- | Attach a rendered return value to the most recently completed frame.
traceSetLastOutput :: MonadIO m => Maybe VmTracer -> Text -> m ()
traceSetLastOutput mt out =
  onTracer mt $ \ts -> case tsStack ts of
    (pf : rest) -> case pfCalls pf of
      (c : cs) -> ts {tsStack = pf {pfCalls = c {cfOutput = Just out} : cs} : rest}
      [] -> ts
    [] -> case tsRoots ts of
      (r : rs) -> ts {tsRoots = r {cfOutput = Just out} : rs}
      [] -> ts

traceAddLog :: MonadIO m => Maybe VmTracer -> TraceLog -> m ()
traceAddLog mt tl =
  onTracer mt $ \ts -> case tsStack ts of
    (pf : rest) -> ts {tsStack = pf {pfLogs = tl : pfLogs pf} : rest}
    [] -> ts

traceStatement :: MonadIO m => Maybe VmTracer -> Text -> Int -> Int -> Int -> Integer -> m ()
traceStatement mt source line col depth gasLeft =
  onTracer mt $ \ts ->
    if not (tsStatements ts)
      then ts
      else
        if tsStatementCount ts >= maxStatements
          then ts {tsTruncated = True}
          else case tsStack ts of
            (pf : rest) ->
              ts
                { tsStack = pf {pfStatements = StatementEntry source line col depth gasLeft : pfStatements pf} : rest,
                  tsStatementCount = tsStatementCount ts + 1
                }
            [] -> ts

-- | Finished root frames in execution order, plus whether statement entries
-- were truncated. Frames still open (e.g. after a top-level exception) are
-- closed as errored so a partial trace is never silently dropped.
takeTraceRoots :: MonadIO m => VmTracer -> m ([CallFrame], Bool)
takeTraceRoots t@(VmTracer ref) = do
  ts <- liftIO $ readIORef ref
  case tsStack ts of
    [] -> pure (reverse (tsRoots ts), tsTruncated ts)
    _ -> do
      traceExitFrame (Just t) 0 (Just "unwound")
      takeTraceRoots t
