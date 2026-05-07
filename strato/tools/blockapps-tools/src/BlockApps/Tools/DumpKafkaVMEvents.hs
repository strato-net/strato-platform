{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module BlockApps.Tools.DumpKafkaVMEvents where

import Blockchain.EthConf
import Blockchain.Stream.VMEvent
import Control.Monad.Composable.Kafka
import Control.Monad.IO.Class
import Text.Format

dumpKafkaVMEvents :: Offset -> IO ()
dumpKafkaVMEvents _ =
  runKafkaMConfigured "queryStrato" $
    consume "queryStrato" "vmevents" $ \(vmEvents :: [VMEvent]) ->
      liftIO $ putStrLn $ unlines $ map format vmEvents
