{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# OPTIONS_GHC -Wall #-}

import Control.Concurrent (threadDelay)
import Control.Concurrent.Async (race_)
import Control.Monad (forever)
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as M
import Network.Wai.Middleware.Prometheus
import Network.Wai.Handler.Warp
import Prometheus
import System.Process
import Text.Read (readMaybe)

stratoP2pMemoryUsage :: Gauge
stratoP2pMemoryUsage = unsafeRegister $ gauge (Info "strato_p2p_memory" "strato-p2p memory usage")

stratoP2pCpuUsage :: Gauge
stratoP2pCpuUsage = unsafeRegister $ gauge (Info "strato_p2p_cpu" "strato-p2p CPU usage")

stratoSequencerMemoryUsage :: Gauge
stratoSequencerMemoryUsage = unsafeRegister $ gauge (Info "strato_sequencer_memory" "strato-sequencer memory usage")

stratoSequencerCpuUsage :: Gauge
stratoSequencerCpuUsage = unsafeRegister $ gauge (Info "strato_sequencer_cpu" "strato-sequencer CPU usage")

vmRunnerMemoryUsage :: Gauge
vmRunnerMemoryUsage = unsafeRegister $ gauge (Info "vm_runner_memory" "vm-runner memory usage")

vmRunnerCpuUsage :: Gauge
vmRunnerCpuUsage = unsafeRegister $ gauge (Info "vm_runner_cpu" "vm-runner CPU usage")

slipstreamMemoryUsage :: Gauge
slipstreamMemoryUsage = unsafeRegister $ gauge (Info "slipstream_memory" "slipstream memory usage")

slipstreamCpuUsage :: Gauge
slipstreamCpuUsage = unsafeRegister $ gauge (Info "slipstream_cpu" "slipstream CPU usage")

stratoApiMemoryUsage :: Gauge
stratoApiMemoryUsage = unsafeRegister $ gauge (Info "strato_api_memory" "strato-api memory usage")

stratoApiCpuUsage :: Gauge
stratoApiCpuUsage = unsafeRegister $ gauge (Info "strato_api_cpu" "strato-api CPU usage")

stratoApiIndexerMemoryUsage :: Gauge
stratoApiIndexerMemoryUsage = unsafeRegister $ gauge (Info "strato_api_indexer_memory" "strato-api-indexer memory usage")

stratoApiIndexerCpuUsage :: Gauge
stratoApiIndexerCpuUsage = unsafeRegister $ gauge (Info "strato_api_indexer_cpu" "strato-api-indexer CPU usage")

stratoP2pIndexerMemoryUsage :: Gauge
stratoP2pIndexerMemoryUsage = unsafeRegister $ gauge (Info "strato_p2p_indexer_memory" "strato-p2p-indexer memory usage")

stratoP2pIndexerCpuUsage :: Gauge
stratoP2pIndexerCpuUsage = unsafeRegister $ gauge (Info "strato_p2p_indexer_cpu" "strato-p2p-indexer CPU usage")

stratoTxrIndexerMemoryUsage :: Gauge
stratoTxrIndexerMemoryUsage = unsafeRegister $ gauge (Info "strato_txr_indexer_memory" "strato-txr-indexer memory usage")

stratoTxrIndexerCpuUsage :: Gauge
stratoTxrIndexerCpuUsage = unsafeRegister $ gauge (Info "strato_txr_indexer_cpu" "strato-txr-indexer CPU usage")

vaultProxyMemoryUsage :: Gauge
vaultProxyMemoryUsage = unsafeRegister $ gauge (Info "vault_proxy_memory" "vault-proxy memory usage")

vaultProxyCpuUsage :: Gauge
vaultProxyCpuUsage = unsafeRegister $ gauge (Info "vault_proxy_cpu" "vault-proxy CPU usage")

processMonitorMemoryUsage :: Gauge
processMonitorMemoryUsage = unsafeRegister $ gauge (Info "process_monitor_memory" "process-monitor memory usage")

processMonitorCpuUsage :: Gauge
processMonitorCpuUsage = unsafeRegister $ gauge (Info "process_monitor_cpu" "process-monitor CPU usage")

updateGauge :: Gauge -> String -> Map String ProcessInfo -> (ProcessInfo -> IO (Maybe Double)) -> IO ()
updateGauge g l m f = do
  case M.lookup (take 15 l) m of
    Nothing -> pure ()
    Just a -> f a >>= \a' -> case a' of
      Nothing -> pure ()
      Just a'' -> setGauge g a''

updateGauges :: Map String ProcessInfo -> IO ()
updateGauges m = do
  -- updateGauge stratoP2pMemoryUsage "pid1" m (\p -> let r = piRes p in print r >> pure (readMaybe r))
  updateGauge stratoP2pMemoryUsage "strato-p2p" m (\p -> let r = piPercentMem p in print r >> pure (fmap (1000*) $ readMaybe r))
  updateGauge stratoP2pCpuUsage "strato-p2p" m (pure . readMaybe . piPercentCpu)
  updateGauge stratoSequencerMemoryUsage "strato-sequencer" m (pure . fmap (1000*) . readMaybe . piPercentMem)
  updateGauge stratoSequencerCpuUsage "strato-sequencer" m (pure . readMaybe . piPercentCpu)
  updateGauge vmRunnerMemoryUsage "vm-runner" m (pure . fmap (1000*) . readMaybe . piPercentMem)
  updateGauge vmRunnerCpuUsage "vm-runner" m (pure . readMaybe . piPercentCpu)
  updateGauge slipstreamMemoryUsage "slipstream" m (pure . fmap (1000*) . readMaybe . piPercentMem)
  updateGauge slipstreamCpuUsage "slipstream" m (pure . readMaybe . piPercentCpu)
  updateGauge stratoApiMemoryUsage "strato-api" m (pure . fmap (1000*) . readMaybe . piPercentMem)
  updateGauge stratoApiCpuUsage "strato-api" m (pure . readMaybe . piPercentCpu)
  updateGauge stratoApiIndexerMemoryUsage "strato-api-indexer" m (pure . fmap (1000*) . readMaybe . piPercentMem)
  updateGauge stratoApiIndexerCpuUsage "strato-api-indexer" m (pure . readMaybe . piPercentCpu)
  updateGauge stratoP2pIndexerMemoryUsage "strato-p2p-indexer" m (pure . fmap (1000*) . readMaybe . piPercentMem)
  updateGauge stratoP2pIndexerCpuUsage "strato-p2p-indexer" m (pure . readMaybe . piPercentCpu)
  updateGauge stratoTxrIndexerMemoryUsage "strato-txr-indexer" m (pure . fmap (1000*) . readMaybe . piPercentMem)
  updateGauge stratoTxrIndexerCpuUsage "strato-txr-indexer" m (pure . readMaybe . piPercentCpu)
  updateGauge vaultProxyMemoryUsage "vault-proxy" m (pure . fmap (1000*) . readMaybe . piPercentMem)
  updateGauge vaultProxyCpuUsage "vault-proxy" m (pure . readMaybe . piPercentCpu)
  updateGauge processMonitorMemoryUsage "process-monitor-exe" m (pure . fmap (1000*) . readMaybe . piPercentMem)
  updateGauge processMonitorCpuUsage "process-monitor-exe" m (pure . readMaybe . piPercentCpu)

data ProcessInfo = ProcessInfo
  { piPercentCpu :: String
  , piPercentMem :: String
  , piCommand    :: String
  } deriving (Eq, Show)

parseProcessInfo :: String -> Either String ProcessInfo
parseProcessInfo input = case words input of
  (cpu : mem : cmd : _) ->
    Right $ ProcessInfo cpu mem cmd
  _ -> Left $ "Could not parse ProcessInfo: " ++ input

mergeProcessInfo :: ProcessInfo -> Map String ProcessInfo -> Map String ProcessInfo
mergeProcessInfo p m = m <> M.singleton (take 15 $ piCommand p) p

createProcessMap :: [String] -> IO (Map String ProcessInfo)
createProcessMap = go M.empty
  where go m [] = pure m
        go m (l:ls) = do
          case parseProcessInfo l of
            Left e -> putStrLn e >> pure m
            Right p -> go (mergeProcessInfo p m) ls

runProcessMonitoring :: IO ()
runProcessMonitoring = forever $ do
  threadDelay 1000000
  output <- readCreateProcess (shell "ps -eo %cpu,rss,cmd --sort -%cpu") ""
  mapM_ putStrLn $ lines output
  putStrLn "-------------------------------------------"
  m <- createProcessMap . drop 1 $ lines output
  updateGauges m
  print m

main :: IO ()
main = do
  race_ runProcessMonitoring
    . run 10778
    $ metricsApp