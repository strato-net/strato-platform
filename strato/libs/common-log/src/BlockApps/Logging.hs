{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module BlockApps.Logging
  ( flags_minLogLevel,
    LoggingT,
    runLoggingT,
    runLoggingTWithLevel,
    runNoLoggingT,
    module Control.Monad.Logger,
    logDebugLS,
    logInfoLS,
    logWarnLS,
    logErrorLS,
    formatLogOutput, -- For testing
  )
where

import Control.Concurrent (ThreadId, myThreadId)
import Control.Monad
import Control.Monad.Logger hiding (LoggingT, runLoggingT, runNoLoggingT)
import qualified Control.Monad.Logger as ML
import qualified Data.ByteString.Char8 as BC
import Data.Fixed
import qualified Data.Text as Text
import Data.Time
import HFlags
import Language.Haskell.TH
import Language.Haskell.TH.Syntax
import System.GlobalLock
import System.IO
import Text.Printf

defineEQFlag "minLogLevel" [|ML.LevelInfo :: LogLevel|] "MINLOGLEVEL" "Minimum log level to display"

type LoggingT = ML.LoggingT

runLoggingT :: LoggingT m a -> m a
runLoggingT = runLoggingTWithLevel flags_minLogLevel

runLoggingTWithLevel :: LogLevel -> LoggingT m a -> m a
runLoggingTWithLevel level = flip ML.runLoggingT (commonLog level)

runNoLoggingT :: LoggingT m a -> m a
runNoLoggingT = flip ML.runLoggingT devNull

-------------------------------------------------

devNull :: Loc -> LogSource -> LogLevel -> LogStr -> IO ()
devNull _ _ _ _ = return ()

commonLog :: LogLevel -> Loc -> LogSource -> LogLevel -> LogStr -> IO ()
commonLog minLogLevel loc logSource level msg = do
  when (level >= minLogLevel) $ do
    myTID <- myThreadId
    timestamp <- getCurrentTime
    lock $ formatLogOutput timestamp myTID loc logSource level msg
    hFlush stdout

formatLogOutput ::
  PrintfType r =>
  UTCTime ->
  ThreadId ->
  Loc ->
  LogSource ->
  LogLevel ->
  LogStr ->
  r
formatLogOutput timestamp tid loc logSource level msg =
  printf "[%-33s] %s%5s | %-14s | %-35s | %s\n" timestamp mLoc level tid logSource msg
  where
    mLoc = if (level == LevelDebug || level == LevelWarn) then printf "%50s | " loc else ""

instance PrintfArg UTCTime where
  formatArg = formatString . customShow . utcToZonedTime utc
    where
      customShow (ZonedTime (LocalTime d (TimeOfDay h m s)) zone) =
        concat [showGregorian d, " ", show2 h, ":", show2 m, ":", rightPad (show2Fixed s) 12 '0', " ", show zone]
      show2Fixed x
        | x < 10 = '0' : (showFixed True x)
      show2Fixed x = showFixed True x
      show2 i
        | i < 10 = '0' : show i
      show2 i = show i
      -- rightPad is our addition. The rest of the previous code is derived from the time library
      rightPad s l c = s ++ replicate (l - length s) c

instance PrintfArg LogLevel where
  formatArg =
    formatString
      . ( \case
            LevelDebug -> "DEBUG"
            LevelInfo -> "INFO"
            LevelWarn -> "WARN"
            LevelError -> "ERROR"
            LevelOther o -> Text.unpack o
        )

instance PrintfArg ThreadId where
  formatArg = formatString . show

instance PrintfArg Loc where
  formatArg = formatString . (\Loc {..} -> printf "%s:%d" loc_filename (fst loc_start) :: String)

instance PrintfArg LogStr where
  formatArg = formatString . BC.unpack . fromLogStr

logDebugLS :: Q Exp
logDebugLS = [|\a b -> monadLoggerLog $(qLocation >>= liftLoc) a LevelDebug (show b)|]

logInfoLS :: Q Exp
logInfoLS = [|\a b -> monadLoggerLog $(qLocation >>= liftLoc) a LevelInfo (show b)|]

logWarnLS :: Q Exp
logWarnLS = [|\a b -> monadLoggerLog $(qLocation >>= liftLoc) a LevelWarn (show b)|]

logErrorLS :: Q Exp
logErrorLS = [|\a b -> monadLoggerLog $(qLocation >>= liftLoc) a LevelError (show b)|]
