{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module BlockApps.Tools.DumpKafkaVMEvents where

import Blockchain.EthConf
import Blockchain.Stream.VMEvent
import Control.Monad.Composable.Streaming
import Control.Monad.IO.Class
import Text.Format

dumpKafkaVMEvents :: IO ()
dumpKafkaVMEvents =
  runStreamMConfigured "queryStrato" $
    consume "queryStrato" "vmevents" $ \(vmEvents :: [VMEvent]) ->
      liftIO $ putStrLn $ unlines $ map format vmEvents
