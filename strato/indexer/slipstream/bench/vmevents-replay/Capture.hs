{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

import Blockchain.Stream.VMEvent (VMEvent)
import Control.Monad (void)
import Control.Monad.Composable.Streaming (runConsume, runStreamM)
import Control.Monad.IO.Class (liftIO)
import Data.Binary (encodeFile)
import Data.IORef
import Data.List (intercalate)
import Data.String (fromString)
import System.Environment (getArgs)
import Text.Read (readMaybe)

usage :: String
usage = "usage: capture-vmevents HOST PORT GROUP SKIP COUNT OUTPUT"

positiveInt :: String -> IO Int
positiveInt value =
  case readMaybe value of
    Just number | number >= 0 -> pure number
    _ -> fail $ "expected a non-negative integer, got: " ++ value

main :: IO ()
main = do
  args <- getArgs
  (host, port, groupName, skipCount, captureCount, outputPath) <-
    case args of
      [host', portText, groupName', skipText, countText, outputPath'] -> do
        port' <- positiveInt portText
        skipCount' <- positiveInt skipText
        captureCount' <- positiveInt countText
        pure (host', port', groupName', skipCount', captureCount', outputPath')
      _ -> fail usage

  seenRef <- newIORef 0
  capturedRef <- newIORef []
  capturedCountRef <- newIORef 0

  void . runStreamM "slipstream-vmevents-capture" (host, port) $
    runConsume (fromString groupName) "vmevents" $ \(batch :: [VMEvent]) -> liftIO $ do
      seen <- readIORef seenRef
      capturedCount <- readIORef capturedCountRef
      let skipFromBatch = max 0 (skipCount - seen)
          available = drop skipFromBatch batch
          needed = captureCount - capturedCount
          selected = take needed available
          capturedCount' = capturedCount + length selected
      modifyIORef' capturedRef (selected :)
      writeIORef seenRef $ seen + length batch
      writeIORef capturedCountRef capturedCount'
      pure $ if capturedCount' >= captureCount then Just () else Nothing

  capturedChunks <- readIORef capturedRef
  let batches = filter (not . null) $ reverse capturedChunks
      captured = sum $ map length batches
      batchSizes = map length batches
  encodeFile outputPath batches
  putStrLn $ "captured_vmevents=" ++ show captured
  putStrLn $ "captured_batches=" ++ show (length batches)
  putStrLn $ "batch_sizes=" ++ intercalate "," (map show batchSizes)
  putStrLn $ "skipped_vmevents=" ++ show skipCount
  putStrLn $ "output=" ++ outputPath
