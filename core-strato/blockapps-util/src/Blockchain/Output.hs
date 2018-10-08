{-# LANGUAGE QuasiQuotes     #-}
{-# LANGUAGE TemplateHaskell #-}

module Blockchain.Output
    ( printLogMsg
    , printToFile
    , dropLogMsg
    , leftPad  -- todo: not enough NPM
    , rightPad  -- todo: not enough NPM
    ) where

import           Control.Concurrent     (ThreadId, myThreadId)
import           Control.Monad
import           Control.Monad.Logger
import qualified Data.ByteString.Char8  as BC
import qualified Data.Text              as Text
import           System.GlobalLock
import           System.IO
import           System.Log.FastLogger  (fromLogStr)

import           Text.Printf

import           Data.Time
import           HFlags

defineEQFlag "minLogLevel" [| LevelInfo :: LogLevel |] "MINLOGLEVEL"  "Minimum log level to display"

leftPad :: Int -> a -> [a] -> [a]
leftPad n x xs = replicate (max 0 (n - length xs)) x ++ xs

rightPad :: Int -> a -> [a] -> [a]
rightPad n x xs = xs ++ replicate (max 0 (n - length xs)) x

-- todo: do something more efficient than a bunch of printfs?
-- todo: the pack/unpack in formatLogOutput is probably pain...
formatLoc :: Loc -> String
formatLoc Loc{ loc_filename = file
             , loc_start    = (line, _)
             } = leftPad 50 ' ' $ printf "%s:%d" file line

formatLogSource :: LogSource -> String
formatLogSource = rightPad 35 ' ' . Text.unpack

formatLogLevel :: LogLevel -> String
formatLogLevel = leftPad 5 ' ' . helper
    where helper LevelDebug     = "DEBUG"
          helper LevelInfo      = "INFO"
          helper LevelWarn      = "WARN"
          helper LevelError     = "ERROR"
          helper (LevelOther o) = show o

formatLogStr :: LogStr -> String
formatLogStr = BC.unpack . fromLogStr

formatThreadId :: ThreadId -> String
formatThreadId = rightPad 14 ' ' . show

formatLogOutput :: Bool
                -> String
                -> ThreadId
                -> Loc
                -> LogSource
                -> LogLevel
                -> LogStr
                -> BC.ByteString
formatLogOutput showTS timestamp tid loc logSource level msg = BC.pack $
    printf "%s%s%s | %s | %s | %s" tsAndDivider locAndDivider (formatLogLevel level) (formatThreadId tid) (formatLogSource logSource) (formatLogStr msg)
    where locAndDivider = if (level == LevelDebug || level == LevelWarn) then formatLoc loc ++ " | " else ""
          tsAndDivider = if showTS then '[':(timestamp ++ "] ") else ""

dropLogMsg :: Loc -> LogSource -> LogLevel -> LogStr -> IO ()
dropLogMsg _ _ _ _ = return ()

printLogMsg :: Loc
            -> LogSource
            -> LogLevel
            -> LogStr
            -> IO ()
printLogMsg = printLogMsg' True

printLogMsg' :: Bool
             -> Loc
             -> LogSource
             -> LogLevel
             -> LogStr
             -> IO ()
printLogMsg' showTimestamp loc logSource level msg = do
  myTID <- myThreadId
  timestamp <- if showTimestamp then rightPad 30 ' ' . show <$> getCurrentTime else return ""
  when (shouldShow level) $ do
    lock . putStrLn . BC.unpack $ formatLogOutput showTimestamp timestamp myTID loc logSource level msg
    hFlush stdout

shouldShow :: LogLevel -> Bool
shouldShow = (>= flags_minLogLevel)

printToFile :: FilePath -> Loc -> LogSource -> LogLevel -> LogStr -> IO ()
printToFile path _ _ _ msg = lock . appendFile path $ formatLogStr msg ++ "\n"

