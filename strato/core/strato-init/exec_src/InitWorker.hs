{-# LANGUAGE BangPatterns #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import qualified Data.Aeson as Ae
import Data.ByteString.Base64
import qualified Data.ByteString.Char8 as C8
import Data.Either.Extra
import Data.String
import HFlags
import qualified Blockchain.Network as Net

import BlockApps.Logging
import Blockchain.Init.Worker
import Blockchain.Strato.Model.ChainMember

defineFlag "K:kafkahost" (""  ::  String) "Kafka hostname"
defineFlag "vaultWrapperUrl" ("http://localhost:8013/strato/v2.3" :: String) "The Vault-Wrapper URL"
defineFlag "genesisBlockTestCert" (False :: Bool) "Generate a test X509 Certificate using this node's public key - ideal for asin"
defineFlag "network" ("" :: String) "The network that strato will join"
defineFlag "validators" ("[]" :: String) "JSON encoded addresses of Blockstanbul validators"
defineFlag "blockstanbul_admins" ("[]" :: String) "JSON encoded addresses of network admins. Admins can, for instance, nominate a new validator"
defineFlag "genesisCerts" ("[]" :: String) "Extra certs passed into the genesis block"
$(return [])

main :: IO ()
main = do
  _ <- $initHFlags "init-worker"
  let kaddr = case flags_kafkahost of
                  "" -> ("kafka", 9092)
                  _ -> (fromString flags_kafkahost, 9092)
  maybeNetworkParams <- Net.getParams flags_network
  --  Allow these flags to accept base64-encoded JSONs optionally
  let b64decode inp = if isBase64 inp then (fromRight inp . decodeBase64) inp else inp
      eValidators = (Ae.eitherDecodeStrict . b64decode) (C8.pack flags_validators) :: Either String [ChainMemberParsedSet]
      !validators' =
        case (maybeNetworkParams, eValidators) of
          (Just networkParams, Right []) -> map Net.identity networkParams
          (_, Right v) -> v
          (_, Left e) -> error $ "invalid validators: " ++ e
      eAdmins = (Ae.eitherDecodeStrict . b64decode) (C8.pack flags_blockstanbul_admins) :: Either String [ChainMemberParsedSet]
      !admins' =
        case (maybeNetworkParams, eAdmins) of
          (Just networkParams, Right []) -> map Net.identity networkParams
          (_, Right v) -> v
          (_, Left e) -> error $ "invalid admins: " ++ e
  runLoggingT $ runWorker validators' admins' kaddr
