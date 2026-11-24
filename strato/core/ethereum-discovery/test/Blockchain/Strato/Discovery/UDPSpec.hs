{-# LANGUAGE OverloadedStrings #-}

{-# OPTIONS -fno-warn-deprecations #-}

module Blockchain.Strato.Discovery.UDPSpec where

import Blockchain.Data.PubKey (secPubKeyToPoint)
import Blockchain.Data.RLP
import Blockchain.Strato.Discovery.Data.Peer (TCPPort (..), UDPPort (..))
import Blockchain.Strato.Discovery.UDP
import Blockchain.Strato.Discovery.UDPServer (keepsHeldKey)
import Blockchain.Strato.Model.Address (fromPublicKey)
import Blockchain.Strato.Model.Keccak256 (hash, keccak256ToByteString)
import Blockchain.Strato.Model.Secp256k1 (PrivateKey, derivePublicKey, exportSignature, newPrivateKey, signMsg)
import Blockchain.Strato.Model.Validator (Validator (..))
import Crypto.Types.PubKey.ECC (Point (..))
import Data.Bits
import qualified Data.ByteString as B
import Data.Word (Word8)
import Network.Socket (tupleToHostAddress, tupleToHostAddress6)
import Test.Hspec
import Text.Format

spec :: Spec
spec = do
  describe "keepsHeldKey" $ do
    it "keeps a validator's key against a packet signed with another key, and only then" $ do
      validator <- derivePublicKey <$> newPrivateKey
      other <- derivePublicKey <$> newPrivateKey
      let point = secPubKeyToPoint
          validators = Just [Validator $ fromPublicKey validator]
      keepsHeldKey validators (Just $ point validator) (point other) `shouldBe` True
      keepsHeldKey validators (Just $ point validator) (point validator) `shouldBe` False
      keepsHeldKey (Just []) (Just $ point validator) (point other) `shouldBe` False
      keepsHeldKey validators Nothing (point other) `shouldBe` False
      keepsHeldKey validators (Just $ point other) (point validator) `shouldBe` False

    it "keeps any held key while the validator set cannot be read, but not an invalid one" $ do
      held <- secPubKeyToPoint . derivePublicKey <$> newPrivateKey
      other <- secPubKeyToPoint . derivePublicKey <$> newPrivateKey
      keepsHeldKey Nothing (Just held) other `shouldBe` True
      keepsHeldKey Nothing Nothing other `shouldBe` False
      -- off the curve: a Neighbors packet could store it, and a real packet must replace it
      keepsHeldKey Nothing (Just $ Point 0 0) other `shouldBe` False

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

  describe "pongSenderTcpPort" $ do
    it "takes a port" $
      pongSenderTcpPort (rlpEncode (30303 :: Integer)) `shouldBe` Just (TCPPort 30303)

    it "ignores ENR sequence numbers" $
      map (pongSenderTcpPort . rlpEncode) [1794679825, 1791519288486, 3 :: Integer] `shouldBe` [Nothing, Nothing, Nothing]

  describe "Pong" $ do
    it "echoes the hash of the Ping it answers, which an old node's Pong does not" $ do
      pinger <- newPrivateKey
      ponger <- newPrivateKey
      let ep = Endpoint (stringToIAddr "10.0.0.1") (UDPPort 30303) (TCPPort 30303)
          ping = signedPacket pinger $ ndPacketToRLP (Ping 4 ep ep 100)
          pong = Pong ep (packetHash ping) 100 (Just $ TCPPort 30303)
          oldPong = (2, RLPArray [rlpEncode ep, rlpEncode (4 :: Integer), rlpEncode (100 :: Integer)])
          echoOf packet = case dataToPacket packet of
            Right (Pong _ echo _ _, _) -> Just echo
            _ -> Nothing
      -- the pinger notes the hash it heads the Ping with
      packetHash ping `shouldBe` B.take 32 ping
      echoOf (signedPacket ponger $ ndPacketToRLP pong) `shouldBe` Just (B.take 32 ping)
      echoOf (signedPacket ponger oldPong) `shouldBe` Just (B.singleton 4)
      -- an old node reads the field as a number, so still reads the new Pong
      case ndPacketToRLP pong of
        (_, RLPArray (_ : echo : _)) -> (rlpDecode echo :: Integer) `shouldSatisfy` (> 0)
        other -> expectationFailure $ show other

  describe "IAddr RLP Serialization" $ do
    it "parses ipv6 addresses" $ do
      let addr = rlpDecode . rlpEncode $ stringToIAddr "2001:0db8:85a3:0000:0000:8a2e:0370:7334"
      addr `shouldBe` (IPV6Addr (536939960, 2242052096, 35374, 57701172))

-- | A packet framed and signed as 'sendPacket' sends it.
signedPacket :: PrivateKey -> (Word8, RLPObject) -> B.ByteString
signedPacket key (theType, rlp) =
  let body = B.cons theType (rlpSerialize rlp)
      signed = exportSignature (signMsg key . keccak256ToByteString $ hash body) <> body
   in keccak256ToByteString (hash signed) <> signed
