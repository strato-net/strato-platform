module Main where

import Blockchain.EthConf
import Blockchain.Strato.Model.Address
import Crypto.Random.Entropy
import Network.Haskoin.Crypto
import qualified Data.ByteString.Char8 as BS
import qualified Data.ByteString.Base64 as B64
import Data.Yaml

main :: IO ()
main = do
  pk <- withSource getEntropy genPrvKey
  let confpath = "/var/lib/strato/.ethereumH/ethconf.yaml"
      keypath = "/var/lib/strato/coinbase"
      addr = prvKey2Address pk
  eYaml <- decodeFileEither confpath :: IO (Either ParseException EthConf)
  let yaml = case eYaml of
                Left err -> error $ "could not decade ethconf.yaml: " ++ show err
                Right yaml' -> yaml'
  let qc = quarryConfig yaml
  encodeFile confpath yaml{quarryConfig=qc{coinbaseAddress = formatAddress addr}}
  BS.writeFile keypath . B64.encode . encodePrvKey $ pk
