{-# LANGUAGE OverloadedStrings #-}

import BlockApps.Init
import Control.Concurrent
import Control.Monad
import System.Environment

main :: IO ()
main = do
  blockappsInit "test-reload"
  mp <- getProgName
  args <- getArgs
  print (mp, args)
  mid <- myThreadId
  print ("main thread id" :: String, mid)
  cid <- forkIO $ do
    tid <- myThreadId
    forM_ [0 ..] $ \n -> do
      print (tid, n :: Int)
      threadDelay 200000
  print ("child thread id" :: String, cid)
  threadDelay 100000000000
