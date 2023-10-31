module Blockchain.Strato.Discovery.Data.PeerSpec
  ( spec,
  )
where

import Blockchain.Strato.Discovery.Data.Peer
import Test.Hspec

publicKey :: String
publicKey = take 128 (repeat '1')

port :: Int
port = 30303

mkAddress :: String -> String
mkAddress host = mkAddress' (Just publicKey) host port

mkIPv6Address :: String -> String
mkIPv6Address host = mkAddress' (Just publicKey) ("[" <> host <> "]") port

mkAddress' :: Maybe String -> String -> Int -> String
mkAddress' mPubKey host portNum =
  case mPubKey of
    Nothing -> "enode://" <> host <> ":" <> show portNum
    (Just key) -> "enode://" <> key <> "@" <> host <> ":" <> show portNum

spec :: Spec
spec = do
  describe "parseEnode" $ do
    it "parses IP addresses like 192.168.1.17" $ do
      let ip = "192.168.1.17"
      parseEnode (mkAddress ip) `shouldBe` Right (Just publicKey, ip, port)

    it "parses IP addresses like 10.10.1.10" $ do
      let ip = "10.10.1.10"
      parseEnode (mkAddress ip) `shouldBe` Right (Just publicKey, ip, port)

    it "parses IP addresses like 0.0.0.0" $ do
      let ip = "0.0.0.0"
      parseEnode (mkAddress ip) `shouldBe` Right (Just publicKey, ip, port)

    it "parses an IPv6 address" $ do
      let ip = "2001:0db8:85a3:0000:0000:8a2e:0370:7334"
      parseEnode (mkIPv6Address ip) `shouldBe` Right (Just publicKey, ip, port)

    it "parses docker-like hostname aliases" $ do
      let hostname = "somedockerhostname"
      parseEnode (mkAddress hostname) `shouldBe` Right (Just publicKey, hostname, port)

    it "parses domain names" $ do
      let hostname = "cheeseburgers.com"
      parseEnode (mkAddress hostname) `shouldBe` Right (Just publicKey, hostname, port)

    it "parses domain names with subdomains" $ do
      let hostname = "chili.cheeseburgers.com"
      parseEnode (mkAddress hostname) `shouldBe` Right (Just publicKey, hostname, port)

    it "parses addresses without a public key" $ do
      let hostname = "no-public-key.com"
      parseEnode (mkAddress' Nothing hostname port) `shouldBe` Right (Nothing, hostname, port)

    it "returns a Left when the uri scheme is invalid" $ do
      parseEnode "http://google.com" `shouldBe` Left "Invalid enode: http://google.com"
