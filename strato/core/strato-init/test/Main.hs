{-# LANGUAGE OverloadedStrings #-}

-- | Pins the RTS flag sizing to the acceptance table of the 2026-08-28 A/B
-- benchmark round (strato-net/private#94 follow-up; data in
-- vm-runner/replay/results/2026-08-28-rts-flag-ab.md): pool-first nursery
-- sizing, no GC trimmings (-n/-qg1/-qn measured as no-ops). No tier gets an
-- @-M@ heap cap: the 60%-of-RAM cap aborted 8GB nodes mid-sync (2026-09-29);
-- the ≤16GB tiers compact the oldest generation (@-c@) instead.
--
-- Also pins how strato-setup reads @--role@, which roles may turn
-- monitoring off, run local auth or keep a local node key, and the node key
-- file format of a --localKey validator (what openssl writes, byte for byte).
module Main (main) where

import Blockchain.Init.NodeKey (writeNodeKeyFile)
import Blockchain.Init.Role
import Blockchain.Init.RtsFlags
import Blockchain.Strato.Model.Secp256k1 (derivePublicKey, deriveSharedKey, exportPrivateKey, exportPublicKey, newPrivateKey, recoverPub)
import Control.Monad (forM_)
import Control.Monad.Composable.Base (provide, runEff)
import Control.Monad.Composable.Vault (HasVault (..), VaultData (..))
import Control.Monad.Composable.Vault.NodeKeyFile
import Data.ASN1.BinaryEncoding (DER (..))
import Data.ASN1.BitArray (toBitArray)
import Data.ASN1.Encoding (encodeASN1')
import Data.ASN1.Types
import Data.Bits ((.&.))
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as C8
import Data.Either (isLeft)
import Data.List (isInfixOf, isPrefixOf)
import System.FilePath ((</>))
import System.IO.Temp (withSystemTempDirectory)
import Data.PEM (PEM (..), pemWriteBS)
import System.Posix.Files (fileMode, getFileStatus)
import Test.Hspec

main :: IO ()
main = hspec $ do
  describe "vmRunnerRtsFlags" $ do
    it "4+ cores, >16GB: 256MB pool across 4 capabilities, -F1.2, copying GC" $
      vmRunnerRtsFlags 4 32768 `shouldBe` words "-T -N4 -A64m -I2 -F1.2"
    it "caps -N at 4 on many-core machines (serial mutator)" $
      vmRunnerRtsFlags 16 65536 `shouldBe` words "-T -N4 -A64m -I2 -F1.2"
    it "4 cores, 16GB nominal" $
      vmRunnerRtsFlags 4 16384
        `shouldBe` words "-T -N4 -A64m -I2 -F1.5 -c"
    it "4 cores, real-world 16GB box reporting less than nominal" $
      vmRunnerRtsFlags 4 15975
        `shouldBe` words "-T -N4 -A64m -I2 -F1.5 -c"
    it "2 cores, real-world 8GB: one capability owns the whole 128MB pool" $
      vmRunnerRtsFlags 2 7987
        `shouldBe` words "-T -N1 -A128m -I2 -F1.5 -c"
    it "cgroup-limited container: 2 CPUs, 8GB memory.max" $
      vmRunnerRtsFlags 2 8192
        `shouldBe` words "-T -N1 -A128m -I2 -F1.5 -c"
    it "3 cores, 8GB" $
      vmRunnerRtsFlags 3 8192
        `shouldBe` words "-T -N2 -A64m -I2 -F1.5 -c"
    it "4 cores, 8GB: least-validated cell (32MB per-cap nursery)" $
      vmRunnerRtsFlags 4 8192
        `shouldBe` words "-T -N4 -A32m -I2 -F1.5 -c"
    it "1 core, 4GB: snapshot-only tier" $
      vmRunnerRtsFlags 1 4096
        `shouldBe` words "-T -N1 -A64m -I2 -F1.5 -c"
    it "never emits a heap cap on any tier (an uncapped heap swaps instead of aborting)" $
      forM_ [(c, m) | c <- [1, 2, 3, 4, 16], m <- [2048, 4096, 7933, 8192, 15975, 16384, 32768]] $
        \(cores, memMB) ->
          filter ("-M" `isPrefixOf`) (vmRunnerRtsFlags cores memMB ++ sequencerRtsFlags cores memMB)
            `shouldBe` []

  describe "sequencerRtsFlags" $ do
    it "4+ cores, >16GB" $
      sequencerRtsFlags 8 32768 `shouldBe` words "-T -N2 -A128m -I2"
    it "4 cores, 16GB (nominal and real-world)" $ do
      sequencerRtsFlags 4 16384 `shouldBe` words "-T -N2 -A64m -I2"
      sequencerRtsFlags 4 15975 `shouldBe` words "-T -N2 -A64m -I2"
    it "2 cores, real-world 8GB" $
      sequencerRtsFlags 2 7987 `shouldBe` words "-T -N1 -A64m -I2"
    it "3 cores, 8GB: single capability below 4 cores" $
      sequencerRtsFlags 3 8192 `shouldBe` words "-T -N1 -A64m -I2"
    it "1 core, 4GB" $
      sequencerRtsFlags 1 4096 `shouldBe` words "-T -N1 -A32m -I2"

  describe "renderRtsFlags" $
    it "wraps flags in +RTS/-RTS" $
      renderRtsFlags (words "-T -N2") `shouldBe` "+RTS -T -N2 -RTS"

  describe "parseCgroupCpuMax" $ do
    it "limited: ceil(quota/period)" $
      parseCgroupCpuMax "150000 100000\n" `shouldBe` Just 2
    it "unlimited: 'max <period>'" $
      parseCgroupCpuMax "max 100000\n" `shouldBe` Nothing
    it "garbage" $
      parseCgroupCpuMax "" `shouldBe` Nothing

  describe "parseCgroupMemoryMax" $ do
    it "limited: bytes to MB" $
      parseCgroupMemoryMax "8589934592\n" `shouldBe` Just 8192
    it "unlimited: 'max'" $
      parseCgroupMemoryMax "max\n" `shouldBe` Nothing

  describe "parseMemInfoMB" $ do
    it "reads MemTotal in kB" $
      parseMemInfoMB "MemTotal:       16384000 kB\nMemFree:  123 kB\n"
        `shouldBe` Just 16000
    it "garbage" $
      parseMemInfoMB "no meminfo here" `shouldBe` Nothing

  describe "parseRole" $ do
    it "--role names one of the five roles, case-insensitively" $ do
      parseRole "node" `shouldBe` Right RoleNode
      parseRole "core" `shouldBe` Right RoleCore
      parseRole "api" `shouldBe` Right RoleApi
      parseRole "api-node" `shouldBe` Right RoleApiNode
      parseRole "API-Node" `shouldBe` Right RoleApiNode
      parseRole "validator" `shouldBe` Right RoleValidator
    it "rejects an unknown --role" $ do
      parseRole "lite" `shouldSatisfy` isLeft
      parseRole "" `shouldSatisfy` isLeft

  describe "roleRunsLocalAuth" $
    it "a node or an api-node may run the local identity provider and Vault" $
      filter roleRunsLocalAuth [RoleNode, RoleCore, RoleApi, RoleValidator, RoleApiNode]
        `shouldBe` [RoleNode, RoleApiNode]

  describe "roleAllowsMonitoringOff" $
    it "only an api-node may drop prometheus and apex (--monitoring=false)" $
      filter roleAllowsMonitoringOff [RoleNode, RoleCore, RoleApi, RoleValidator, RoleApiNode]
        `shouldBe` [RoleApiNode]

  describe "roleAllowsLocalKey" $
    it "only a validator may keep its node key in a file (--localKey)" $
      filter roleAllowsLocalKey [RoleNode, RoleCore, RoleApi, RoleValidator, RoleApiNode]
        `shouldBe` [RoleValidator]

  describe "node key file (secrets/node_key.pem)" $ do
    it "reads the EC PRIVATE KEY PEM openssl ecparam writes, and writes it back byte for byte" $ do
      key <- either (fail . ("parse: " ++)) return (parseNodeKey opensslPem)
      hex (exportPrivateKey key) `shouldBe` opensslPrivHex
      hex (exportPublicKey False (derivePublicKey key)) `shouldBe` opensslPubHex
      renderNodeKeyPem key `shouldBe` opensslPem
    it "reads the same key in PKCS#8 form (openssl pkcs8 -topk8 -nocrypt)" $
      fmap exportPrivateKey (parseNodeKey opensslPkcs8) `shouldBe` Right (unhex opensslPrivHex)
    it "skips the EC PARAMETERS block openssl ecparam -genkey writes without -noout" $
      fmap exportPrivateKey (parseNodeKey opensslTwoBlocks) `shouldBe` Right (unhex "d26c6cb7f8ae8e801db2a789c349516b50e7afe2f241a920deb1e1b10894720c")
    it "refuses a key with explicit curve parameters" $
      parseNodeKey opensslExplicitParams `shouldSatisfy` leftMentioning "explicit curve parameters"
    it "refuses a key that does not name its curve" $
      parseNodeKey (ecKeyPem [Start Sequence, IntVal 1, OctetString (unhex opensslPrivHex), End Sequence]) `shouldSatisfy` leftMentioning "does not name its curve"
    it "refuses a key whose embedded public key is not its own" $ do
      other <- newPrivateKey
      let wrongPub = exportPublicKey False (derivePublicKey other)
      parseNodeKey (ecKeyPem
        [ Start Sequence, IntVal 1, OctetString (unhex opensslPrivHex)
        , Start (Container Context 0), OID [1, 3, 132, 0, 10], End (Container Context 0)
        , Start (Container Context 1), BitString (toBitArray wrongPub 0), End (Container Context 1)
        , End Sequence ]) `shouldSatisfy` leftMentioning "public key"
    it "reads 64 hex characters, with or without 0x, ignoring surrounding whitespace" $ do
      fmap exportPrivateKey (parseNodeKey opensslPrivHex) `shouldBe` Right (unhex opensslPrivHex)
      fmap exportPrivateKey (parseNodeKey ("0x" <> opensslPrivHex)) `shouldBe` Right (unhex opensslPrivHex)
      fmap exportPrivateKey (parseNodeKey ("  " <> opensslPrivHex <> "\n")) `shouldBe` Right (unhex opensslPrivHex)
    it "refuses a key on another curve, naming the fix" $
      parseNodeKey p256Pem `shouldSatisfy` leftMentioning "secp256k1"
    it "refuses a passphrase-protected PEM" $
      parseNodeKey encryptedPem `shouldSatisfy` leftMentioning "passphrase"
    it "refuses a PEM block that is not a private key" $
      parseNodeKey "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n" `shouldSatisfy` leftMentioning "CERTIFICATE"
    it "refuses short, non-hex, zero and out-of-range keys" $ do
      parseNodeKey "abcd" `shouldSatisfy` leftMentioning "expected 32 bytes"
      parseNodeKey (C8.replicate 64 'z') `shouldSatisfy` leftMentioning "not hex"
      parseNodeKey (C8.replicate 64 '0') `shouldSatisfy` leftMentioning "not a valid secp256k1"
      parseNodeKey (C8.replicate 64 'f') `shouldSatisfy` leftMentioning "not a valid secp256k1"
    it "round-trips through a 0600 file and names a missing file" $
      withSystemTempDirectory "node-key" $ \dir -> do
        key <- newPrivateKey
        let path = dir </> "node_key.pem"
        writeNodeKeyFile path key
        mode <- fileMode <$> getFileStatus path
        (mode .&. 0o777) `shouldBe` 0o600
        readNodeKeyFile path `shouldReturn` Right key
        missing <- readNodeKeyFile (dir </> "absent.pem")
        missing `shouldSatisfy` leftMentioning "absent.pem"

  describe "local HasVault backend (LocalKey)" $ do
    it "signs with the file key: the signature recovers to getPub, and postKey never makes a new key" $ do
      key <- newPrivateKey
      let h = B.replicate 32 7
      (sig, pub, pub') <- runEff $ provide (LocalKey key) $ (,,) <$> sign h <*> getPub <*> postKey
      pub `shouldBe` derivePublicKey key
      pub' `shouldBe` pub
      recoverPub sig h `shouldBe` Just pub
    it "derives the same ECDH secret from either side" $ do
      a <- newPrivateKey
      b <- newPrivateKey
      sab <- runEff $ provide (LocalKey a) $ getShared (derivePublicKey b)
      sba <- runEff $ provide (LocalKey b) $ getShared (derivePublicKey a)
      sab `shouldBe` sba
      sab `shouldBe` deriveSharedKey a (derivePublicKey b)
  where
    hex = B16.encode
    unhex = either error id . B16.decode
    leftMentioning needle = either (needle `isInfixOf`) (const False)
    ecKeyPem asn1 = pemWriteBS PEM { pemName = "EC PRIVATE KEY", pemHeader = [], pemContent = encodeASN1' DER asn1 }

-- A key generated with `openssl ecparam -name secp256k1 -genkey -noout`,
-- its private scalar and uncompressed public key (`openssl ec -text`), the
-- same key after `openssl pkcs8 -topk8 -nocrypt`, and after
-- `openssl ec -aes256`; and a prime256v1 key.
opensslPem, opensslPkcs8, encryptedPem, p256Pem, opensslTwoBlocks, opensslExplicitParams, opensslPrivHex, opensslPubHex :: B.ByteString
opensslPem = C8.unlines
  [ "-----BEGIN EC PRIVATE KEY-----"
  , "MHQCAQEEIFdcWVX/258WH9w+get5LWYtPBBVZysN9Zp9bHOBdQrJoAcGBSuBBAAK"
  , "oUQDQgAEeBnQStO3qiIDw6RrfL0CkSqA8s0QQ3NUtT/WOA5hP9yhRDE2iGF8Io/I"
  , "yzkY130YWw/aNuoPOgF+oIoYP5deXQ=="
  , "-----END EC PRIVATE KEY-----"
  ]
opensslPrivHex = "575c5955ffdb9f161fdc3e81eb792d662d3c1055672b0df59a7d6c7381750ac9"
opensslPubHex = "047819d04ad3b7aa2203c3a46b7cbd02912a80f2cd10437354b53fd6380e613fdca144313688617c228fc8cb3918d77d185b0fda36ea0f3a017ea08a183f975e5d"
opensslPkcs8 = C8.unlines
  [ "-----BEGIN PRIVATE KEY-----"
  , "MIGEAgEAMBAGByqGSM49AgEGBSuBBAAKBG0wawIBAQQgV1xZVf/bnxYf3D6B63kt"
  , "Zi08EFVnKw31mn1sc4F1CsmhRANCAAR4GdBK07eqIgPDpGt8vQKRKoDyzRBDc1S1"
  , "P9Y4DmE/3KFEMTaIYXwij8jLORjXfRhbD9o26g86AX6gihg/l15d"
  , "-----END PRIVATE KEY-----"
  ]
encryptedPem = C8.unlines
  [ "-----BEGIN EC PRIVATE KEY-----"
  , "Proc-Type: 4,ENCRYPTED"
  , "DEK-Info: AES-256-CBC,1F652D49B015A97E78D9149EB0ECE91C"
  , ""
  , "OS8fwEGykkFuSV9k3Kx+KwGQR8VJYr6V20QWplP1HKjsznSP8ilZhTDxsGww6Il3"
  , "FIbmpA5jEQAc+S6+cCvHUnzUBX+1DLjobJDbwSX14hgytQCfN+o0XOcSRcimWcZb"
  , "gjlsHE8iJPRHBNnJ/pglFg4HLoHhU+/oGjYpXY4gLV0="
  , "-----END EC PRIVATE KEY-----"
  ]
p256Pem = C8.unlines
  [ "-----BEGIN EC PRIVATE KEY-----"
  , "MHcCAQEEIFZPjRsshmYjPD+V0uy+2YBbcRIZV/Z6vnWPkoKaW8mSoAoGCCqGSM49"
  , "AwEHoUQDQgAEhssztac8aI/pNc2Ug0wtRM1kAmtPItCeP4InUjBsyaF9MatfuQYW"
  , "eJw4kxubDKZUs0bf23BGEixNdskR0yO6DA=="
  , "-----END EC PRIVATE KEY-----"
  ]

-- `openssl ecparam -name secp256k1 -genkey` without -noout: parameters block first.
opensslTwoBlocks = C8.unlines
  [ "-----BEGIN EC PARAMETERS-----"
  , "BgUrgQQACg=="
  , "-----END EC PARAMETERS-----"
  , "-----BEGIN EC PRIVATE KEY-----"
  , "MHQCAQEEINJsbLf4ro6AHbKnicNJUWtQ56/i8kGpIN6x4bEIlHIMoAcGBSuBBAAK"
  , "oUQDQgAEJZwnBpKV2XXilIhRTDuz90Zxou2eigTvB2OSMGfSBzwgl8rbDAtYhODf"
  , "yxM/ft3BZTGZmf0cEDN4HeJKOlGm7A=="
  , "-----END EC PRIVATE KEY-----"
  ]
-- `openssl ecparam -name secp256k1 -genkey -noout -param_enc explicit`.
opensslExplicitParams = C8.unlines
  [ "-----BEGIN EC PRIVATE KEY-----"
  , "MIIBUQIBAQQgC7Ki6KQFZNtpTkRlnaxGS9FI8xffwkqGi17WH9fUvPOggeMwgeAC"
  , "AQEwLAYHKoZIzj0BAQIhAP////////////////////////////////////7///wv"
  , "MEQEIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABCAAAAAAAAAAAAAA"
  , "AAAAAAAAAAAAAAAAAAAAAAAAAAAABwRBBHm+Zn753LusVaBilc6HCwcCm/zbLc4o"
  , "2VnygVsW+BeYSDradyajxGVdpPv8DhEIqP0XtEimhVQZnEfQj/sQ1LgCIQD/////"
  , "///////////////+uq7c5q9IoDu/0l6M0DZBQQIBAaFEA0IABBTYuMUsLc8niBuM"
  , "26TtIOmTMSDHY49bFnV+pD3OVQqRmMKJQGk+LUfj0CifS2WH8GHOImcDO/fb3/Gr"
  , "X1nDHrg="
  , "-----END EC PRIVATE KEY-----"
  ]
