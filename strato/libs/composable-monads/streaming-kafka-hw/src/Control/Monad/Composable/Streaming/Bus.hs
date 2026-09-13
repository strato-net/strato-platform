{-# LANGUAGE OverloadedStrings #-}

-- | Connecting to the shared message bus (an external Kafka-compatible
-- cluster) from any STRATO process: turns the node config's bus section
-- into a client environment with TLS and SASL/SCRAM as configured.
module Control.Monad.Composable.Streaming.Bus
  ( BusSettings (..),
    busClientProps,
    createBusEnv,
  )
where

import Control.Monad.Composable.Streaming.Kafka
import Control.Monad.IO.Class (MonadIO)
import qualified Data.Map.Strict as Map
import Data.Text (Text)
import qualified Data.Text as T

-- | The connection half of the bus config (strato-conf's BusConf carries the
-- topic names and submit mode as well; this package cannot depend on it).
data BusSettings = BusSettings
  { bsHost :: String,
    bsPort :: Int,
    -- | "plaintext", "ssl" or "sasl_ssl"
    bsSecurity :: String,
    bsSaslUsername :: Maybe String,
    bsSaslPassword :: Maybe String
  }

busClientProps :: BusSettings -> Map.Map Text Text
busClientProps bs = Map.fromList $
  [("security.protocol", protocol (bsSecurity bs))]
    ++ case (bsSecurity bs, bsSaslUsername bs, bsSaslPassword bs) of
      ("sasl_ssl", Just u, Just p) ->
        [("sasl.mechanisms", "SCRAM-SHA-512"), ("sasl.username", T.pack u), ("sasl.password", T.pack p)]
      _ -> []
  where
    protocol "ssl" = "SSL"
    protocol "sasl_ssl" = "SASL_SSL"
    protocol _ = "PLAINTEXT"

createBusEnv :: MonadIO m => ClientId -> BusSettings -> m StreamEnv
createBusEnv clientId bs = createStreamEnvWith clientId (bsHost bs, bsPort bs) (busClientProps bs)
