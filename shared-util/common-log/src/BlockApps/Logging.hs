{-# LANGUAGE QuasiQuotes     #-}
{-# LANGUAGE LambdaCase      #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module BlockApps.Logging
 ( LoggingT
 , runLoggingT
 , runNoLoggingT
 ) where

import           Control.Concurrent     (ThreadId, myThreadId)
import           Control.Monad
import qualified Data.ByteString.Char8  as BC
import qualified Data.Text              as Text
import           System.GlobalLock
import           System.IO
import           System.Log.FastLogger  (fromLogStr)

import           Text.Printf

import           Data.Time
import           HFlags

import qualified Control.Monad.Logger as ML

defineEQFlag "minLogLevel" [| ML.LevelInfo :: ML.LogLevel |] "MINLOGLEVEL"  "Minimum log level to display"

type LoggingT = ML.LoggingT

runLoggingT :: LoggingT m a -> m a
runLoggingT = flip ML.runLoggingT commonLog

runNoLoggingT :: LoggingT m a -> m a
runNoLoggingT = flip ML.runLoggingT devNull

-------------------------------------------------

devNull :: ML.Loc -> ML.LogSource -> ML.LogLevel -> ML.LogStr -> IO ()
devNull _ _ _ _ = return ()

commonLog :: ML.Loc -> ML.LogSource -> ML.LogLevel -> ML.LogStr -> IO ()
commonLog loc logSource level msg = do
  when (level >= flags_minLogLevel) $ do
    myTID <- myThreadId
    timestamp <- getCurrentTime
    lock $ formatLogOutput timestamp myTID loc logSource level msg
    hFlush stdout


leftPad :: Int -> String -> String
leftPad n xs = replicate (max 0 (n - length xs)) ' ' ++ xs

rightPad :: Int -> String -> String
rightPad n xs = xs ++ replicate (max 0 (n - length xs)) ' '

tRightPad :: Int -> Text.Text -> Text.Text
tRightPad n xs = xs <> Text.replicate (max 0 (n - Text.length xs)) (Text.singleton ' ')

formatLogOutput :: UTCTime
                -> ThreadId
                -> ML.Loc
                -> ML.LogSource
                -> ML.LogLevel
                -> ML.LogStr
                -> IO ()
formatLogOutput timestamp tid loc logSource level msg =
  printf "[%s] %s %s | %s | %s | %s" timestamp level mLoc tid (tRightPad 35 logSource) msg
   where mLoc = if (level == ML.LevelDebug || level == ML.LevelWarn) then printf "%s | " loc else ""

instance PrintfArg UTCTime where
  formatArg = formatString . rightPad 30 . show

instance PrintfArg ML.LogLevel where
  formatArg = formatString . leftPad 5 . (\case
    ML.LevelDebug -> "DEBUG"
    ML.LevelInfo -> "INFO"
    ML.LevelWarn -> "WARN"
    ML.LevelError -> "ERROR"
    ML.LevelOther o -> Text.unpack o)

instance PrintfArg ThreadId where
  formatArg = formatString . rightPad 14 . show

instance PrintfArg ML.Loc where
  formatArg = formatString . (\ML.Loc{..} -> leftPad 50 $ printf "%s:%d" loc_filename (fst loc_start))

instance PrintfArg ML.LogStr where
  formatArg = formatString . BC.unpack . fromLogStr
