{-# LANGUAGE OverloadedStrings #-}

{-# OPTIONS -fno-warn-deprecations #-}

module Blockchain.Strato.Discovery.UDPSpec where

import Blockchain.Data.RLP
import Blockchain.Strato.Discovery.UDP
import Data.Bits
import Network.Socket (tupleToHostAddress, tupleToHostAddress6)
import Test.Hspec
import Text.Format

spec :: Spec
spec = do
  describe "IAddr Format instance" $ do
    it "formats an IPv4 address" $ do
      let addr = tupleToHostAddress (127, 0, 0, 1)
      format (IPV4Addr addr) `shouldBe` "127.0.0.1"

    it "formats an IPv6 address" $ do
      let addr = tupleToHostAddress6 (0x2001, 0x0db8, 0x85a3, 0x0000, 0x0000, 0x8a2e, 0x0370, 0x7334)
      format (IPV6Addr addr) `shouldBe` "370:7334:0:8a2e:85a3:0:2001:db8"

  describe "stringToIAddr" $ do
    it "converts IPv4 addresses" $ do
      stringToIAddr "192.168.1.17"
        `shouldBe` (IPV4Addr $ 192 + (168 `shift` 8) + (1 `shift` 16) + (17 `shift` 24))

    it "converts IPv6 addresses" $ do
      stringToIAddr "2001:0db8:85a3:0000:0000:8a2e:0370:7334"
        `shouldBe` (IPV6Addr (536939960, 2242052096, 35374, 57701172))

    it "converts hostnames" $ do
      stringToIAddr "hotdogs.com" `shouldBe` HostName "hotdogs.com"
  
  describe "IAddr RLP Serialization" $ do
    it "parses ipv6 addresses" $ do
      let addr = rlpDecode . rlpEncode $ stringToIAddr "2001:0db8:85a3:0000:0000:8a2e:0370:7334"
      addr `shouldBe` (IPV6Addr (536939960, 2242052096, 35374, 57701172))
