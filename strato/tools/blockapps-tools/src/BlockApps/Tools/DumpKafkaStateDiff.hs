{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Tools.DumpKafkaStateDiff where

import Blockchain.EthConf
import Blockchain.Stream.Action (Action)
import Control.Monad.Composable.Kafka
import Control.Monad.IO.Class
import Control.Monad.Logger
import qualified Data.Aeson as JSON
import qualified Data.ByteString.Lazy as BL
import Text.Format

toAction :: BL.ByteString -> Action
toAction x =
  case JSON.eitherDecode x of
    Left e -> error $ show e
    Right y -> y

dumpKafkaStateDiff :: Offset -> IO ()
dumpKafkaStateDiff startingBlock | startingBlock /= 0 = error "startingBlock currently can only equal 0"
dumpKafkaStateDiff _ = runStderrLoggingT $ runKafkaMConfigured "queryStrato" $
  consume "queryStrato" "queryStrato" "statediff" $ \() result -> do
    liftIO . putStrLn . unlines . map (++ "\n-----------------------\n") $ format . toAction . BL.fromStrict <$> result
    liftIO $ putStrLn "-----------------------"
    return ()
