{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes       #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TupleSections     #-}

module Blockchain.GenesisBlocks.HeliumGenesisBlock
  ( genesisBlock
  , testGenesisBlock
  ) where

import           BlockApps.X509
import           Blockchain.Data.GenesisInfo
import           Blockchain.GenesisBlocks.Contracts.Decide
import           Blockchain.GenesisBlocks.Contracts.CertRegistry
import           Blockchain.GenesisBlocks.Contracts.GovernanceV2
import           Blockchain.GenesisBlocks.Contracts.Mercata
import qualified Blockchain.GenesisBlocks.Instances.GenesisAssets as GA
import qualified Blockchain.GenesisBlocks.Instances.GenesisEscrows as GE
import qualified Blockchain.GenesisBlocks.Instances.GenesisReserves as GR
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.ChainMember
import           Blockchain.Strato.Model.CodePtr
import qualified Blockchain.Strato.Model.Keccak256               as KECCAK256
import           Blockchain.Strato.Model.Validator
import qualified Data.Aeson                                      as JSON
import qualified Data.ByteString                                 as B
import qualified Data.ByteString.Char8                           as BC
import qualified Data.ByteString.Lazy                            as BL
import qualified Data.Map.Strict                                 as M
import           Data.Maybe                                      (listToMaybe, mapMaybe, maybeToList)
import           Data.Text                                       (Text)
import qualified Data.Text                                       as T
import           Data.Text.Encoding
import           SolidVM.Model.Storable
import           Text.RawString.QQ

genesisBlock :: GenesisInfo
genesisBlock = genesisBlock' usdstAddress
  where
    usdstAddress = case filter ((== "USDST") . GA.name) GA.assets of
      (a:_) -> GA.root a
      _ -> error "No USDST contract found in genesis assets"

testGenesisBlock :: GenesisInfo
testGenesisBlock = genesisBlock' 0x0

genesisBlock' :: Address -> GenesisInfo
genesisBlock' usdstAddress =
  insertMercataGovernanceContract validators admins
  . insertDecideContract usdstAddress
  . insertCertRegistryContract extraCerts
  $ defaultGenesisInfo{
        genesisInfoDifficulty=8192,
        genesisInfoLogBloom=B.replicate 256 0,
        genesisInfoGasLimit=22517998136852480000000000000000,
        genesisInfoCoinbase=Org "00000000000000000000" True,
        genesisInfoAccountInfo=[
            NonContract 0xe1fd0d4a52b75a694de8b55528ad48e2e2cf7859 1809251394333065553493296640760748560207343510400633813116524750123642650624,
            SolidVMContractWithStorage
              0x1000
              720
              (SolidVMCode "Mercata" (KECCAK256.hash $ BL.toStrict $ JSON.encode mercataContracts))
              [ (".:creator", BString $ encodeUtf8 "BlockApps")
              , (".:creatorAddress", BAccount $ unspecifiedChain 0x0dbb9131d99c8317aa69a70909e124f2e02446e8)
              , (".:originAddress", BAccount $ unspecifiedChain 0x1000)
              ]
            ] ++ mapMaybe assetToAccountInfos GA.assets
              ++ concatMap escrowToAccountInfos GE.escrows 
              ++ concatMap reserveToAccountInfos GR.reserves,
        genesisInfoCodeInfo=[CodeInfo (decodeUtf8 $ BL.toStrict $ JSON.encode mercataContracts) (Just "Mercata")]
        }

assetToAccountInfos :: GA.Asset -> Maybe AccountInfo
assetToAccountInfos GA.Asset{..} =
  let times10ToThe a b = foldr (*) a $ replicate b 10
      bigQ q = if decimals < 0 || decimals >= 18 || name == "CATA" || name == "ETHST"
                 then q
                 else if name == "STRAT"
                        then q `times10ToThe` 14
                        else q `times10ToThe` (fromIntegral $ 18 - decimals)
      allBalances = mapMaybe (\(GA.Balance _ o _ q) -> if q > 0 then Just ("._balances<a:" <> encodeUtf8 (T.pack $ formatAddressWithoutColor o) <> ">", BInteger $ bigQ q) else Nothing) $ M.elems balances
      takeCaps = T.pack . filter (\c -> (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) . T.unpack
   in case allBalances of
        [] -> Nothing
        _ -> Just . SolidVMContractWithStorage root 0 (CodeAtAccount 0x1000 "ERC20Asset") $
          [ (".:creator", BString $ encodeUtf8 "BlockApps")
          , (".:creatorAddress", BAccount $ unspecifiedChain 0x0dbb9131d99c8317aa69a70909e124f2e02446e8)
          , (".:originAddress", BAccount $ unspecifiedChain root)
          , (".originAddress", BAccount $ unspecifiedChain root)
          , (".name", BString $ encodeUtf8 name)
          , ("._name", BString $ encodeUtf8 name)
          , ("._symbol", BString $ encodeUtf8 $ takeCaps name)
          , (".description", BString $ encodeUtf8 description)
          , (".owner", BAccount $ unspecifiedChain 0x0dbb9131d99c8317aa69a70909e124f2e02446e8)
          , (".quantity", BInteger . sum $ (\(_, v) -> case v of BInteger i -> i; _ -> 0) <$> allBalances)
          ] ++ map (\(k,v) -> (".images[" <> encodeUtf8 (T.pack $ show k) <> "]", BString $ encodeUtf8 v)) (M.toList images)
            ++ map (\(k,v) -> (".files[" <> encodeUtf8 (T.pack $ show k) <> "]", BString $ encodeUtf8 v)) (M.toList files)
            ++ map (\(k,v) -> (".fileNames[" <> encodeUtf8 (T.pack $ show k) <> "]", BString $ encodeUtf8 v)) (M.toList fileNames)
            ++ mapMaybe (\(k,v) -> ("." <> encodeUtf8 k,) <$> maybeDefault (textToBasicValue v)) (M.toList assetData)
            ++ allBalances
            ++ maybeToList ((\(_,v) -> (".icon", BString $ encodeUtf8 v)) <$> (listToMaybe $ M.toList images))
  where maybeDefault BDefault = Nothing
        maybeDefault v        = Just v

escrowToAccountInfos :: GE.Escrow -> [AccountInfo]
escrowToAccountInfos GE.Escrow{..} =
  -- if not isActive
  --   then []
  --   else
      [ SolidVMContractWithStorage address 0 (CodeAtAccount 0x1000 "SimpleEscrow") $
          [ (".:creator", BString $ encodeUtf8 "BlockApps")
          , (".:creatorAddress", BAccount $ unspecifiedChain 0x0dbb9131d99c8317aa69a70909e124f2e02446e8)
          , (".:originAddress", BAccount $ unspecifiedChain address)
          , (".assetRootAddress", BAccount $ unspecifiedChain assetRootAddress)
          , (".borrowedAmount", BInteger borrowedAmount)
          , (".borrower", BAccount $ unspecifiedChain borrower)
          , (".borrowerCommonName", BString $ encodeUtf8 borrowerCommonName)
          , (".collateralQuantity", BInteger collateralQuantity)
          , (".collateralValue", BInteger collateralValue)
          , (".isActive", BBool isActive)
          , (".lastRewardTimestamp", BInteger lastRewardTimestamp)
          , (".maxLoanAmount", BInteger maxLoanAmount)
          , (".reserve", BAccount $ unspecifiedChain reserve)
          , (".totalCataReward", BInteger totalCataReward)
          , (".liquidationAmount", BInteger liquidationAmount)
          , (".version", BString $ encodeUtf8 version)
          ] ++ map (\(k,v) -> (".assets[" <> encodeUtf8 (T.pack $ show k) <> "]", BAccount $ unspecifiedChain v)) (M.toList assets)
      ]

reserveToAccountInfos :: GR.Reserve -> [AccountInfo]
reserveToAccountInfos GR.Reserve{..} =
  -- if not isActive
  --   then []
  --   else
      [ SolidVMContractWithStorage address 0 (CodeAtAccount 0x1000 "SimpleReserve") $
          [ (".:creator", BString $ encodeUtf8 "BlockApps")
          , (".:creatorAddress", BAccount $ unspecifiedChain 0x0dbb9131d99c8317aa69a70909e124f2e02446e8)
          , (".:originAddress", BAccount $ unspecifiedChain address)
          , (".assetRootAddress", BAccount $ unspecifiedChain assetRootAddress)
          , (".cataAPYRate", BInteger cataAPYRate)
          , (".cataToken", BAccount $ unspecifiedChain cataToken)
          , (".isActive", BBool isActive)
          , (".lastUpdatedOraclePrice", BDecimal . BC.pack $ show lastUpdatedOraclePrice)
          , (".loanToValueRatio", BInteger loanToValueRatio)
          , (".name", BString $ encodeUtf8 name)
          , (".oracle", BAccount $ unspecifiedChain oracle)
          , (".owner", BAccount $ unspecifiedChain owner)
          , (".priceOfCATA", BDecimal . BC.pack $ show priceOfCATA)
          , (".unitConversionRate", BInteger unitConversionRate)
          , (".liquidationRatio", BInteger liquidationRatio)
          , (".usdstToken", BAccount $ unspecifiedChain usdstToken)
          , (".burnerAddress", BAccount $ unspecifiedChain burnerAddress)
          , (".stratstoUSDSTFactor", BInteger stratstoUSDSTFactor)
          , (".usdstPrice", BInteger usdstPrice)
          ]
      ]

certStrings :: [String]
certStrings =
  [
-- CN = Admin, O = BlockApps, OU = '', C = US
    [r|-----BEGIN CERTIFICATE-----
MIIB7DCCAZICFEMvKtLHnafAC+NtPyE602XbANjXMAoGCCqGSM49BAMCMHoxCzAJ
BgNVBAYTAlVTMREwDwYDVQQIDAhOZXcgWW9yazERMA8GA1UEBwwIQnJvb2tseW4x
EjAQBgNVBAoMCUJsb2NrQXBwczEOMAwGA1UEAwwFQWRtaW4xITAfBgkqhkiG9w0B
CQEWEmluZm9AYmxvY2thcHBzLm5ldDAeFw0yNTA1MTUxNDEyNDFaFw0yNTA2MTQx
NDEyNDFaMHoxCzAJBgNVBAYTAlVTMREwDwYDVQQIDAhOZXcgWW9yazERMA8GA1UE
BwwIQnJvb2tseW4xEjAQBgNVBAoMCUJsb2NrQXBwczEOMAwGA1UEAwwFQWRtaW4x
ITAfBgkqhkiG9w0BCQEWEmluZm9AYmxvY2thcHBzLm5ldDBWMBAGByqGSM49AgEG
BSuBBAAKA0IABDzHJIjkUFUq2gjFGtYGxphacY5KkS2CIJdYMDz8Q17nTmxaeKhN
WzZSXO1OJ9pGV+XmogflsPbcUhM1nxbf/HAwCgYIKoZIzj0EAwIDSAAwRQIgC36s
XYTtgQ7oC680AwflmbaqdBXES0NF9R+bWZksaSgCIQDKVknO52m6244djL3EvZ1d
6usbU2KkC+E57SI0rU13rQ==
-----END CERTIFICATE-----|],

-- CN = NodeOne, O = BlockApps, OU = '', C = USA
    [r|-----BEGIN CERTIFICATE-----
MIIBYjCCAQegAwIBAgIRAMXR0KcRXjeBHoaxxoLgGJYwDAYIKoZIzj0EAwIFADAx
MQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMQswCQYDVQQGDAJV
UzAeFw0yNTA1MTUxNDI3MTRaFw0yNjA1MTUxNDI3MTRaMDQxEDAOBgNVBAMMB05v
ZGVPbmUxEjAQBgNVBAoMCUJsb2NrQXBwczEMMAoGA1UEBgwDVVNBMFYwEAYHKoZI
zj0CAQYFK4EEAAoDQgAEPfHnJy73CK8RFh1AUM7d6sflX3Qth+AqYY2MLXFNl/oi
LOyF1KoZLoO9Xd24oXN3ixj7U0BvqFjpVB7FNW7JqjAMBggqhkjOPQQDAgUAA0cA
MEQCIBrthbt2+spomR2ksFyqdHB35Sz9Ya9ExuCWsKiY5g1BAiAwPf5d42eYl6vC
tKj+TnAgQ+h5coRX9SSbO0FBx7QF4w==
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIB7DCCAZICFEMvKtLHnafAC+NtPyE602XbANjXMAoGCCqGSM49BAMCMHoxCzAJ
BgNVBAYTAlVTMREwDwYDVQQIDAhOZXcgWW9yazERMA8GA1UEBwwIQnJvb2tseW4x
EjAQBgNVBAoMCUJsb2NrQXBwczEOMAwGA1UEAwwFQWRtaW4xITAfBgkqhkiG9w0B
CQEWEmluZm9AYmxvY2thcHBzLm5ldDAeFw0yNTA1MTUxNDEyNDFaFw0yNTA2MTQx
NDEyNDFaMHoxCzAJBgNVBAYTAlVTMREwDwYDVQQIDAhOZXcgWW9yazERMA8GA1UE
BwwIQnJvb2tseW4xEjAQBgNVBAoMCUJsb2NrQXBwczEOMAwGA1UEAwwFQWRtaW4x
ITAfBgkqhkiG9w0BCQEWEmluZm9AYmxvY2thcHBzLm5ldDBWMBAGByqGSM49AgEG
BSuBBAAKA0IABDzHJIjkUFUq2gjFGtYGxphacY5KkS2CIJdYMDz8Q17nTmxaeKhN
WzZSXO1OJ9pGV+XmogflsPbcUhM1nxbf/HAwCgYIKoZIzj0EAwIDSAAwRQIgC36s
XYTtgQ7oC680AwflmbaqdBXES0NF9R+bWZksaSgCIQDKVknO52m6244djL3EvZ1d
6usbU2KkC+E57SI0rU13rQ==
-----END CERTIFICATE-----|],

-- CN = NodeTwo, O = BlockApps, OU = '', C = USA
    [r|-----BEGIN CERTIFICATE-----
MIIBYjCCAQagAwIBAgIQQWK9sY3jZKZRssceCy6BezAMBggqhkjOPQQDAgUAMDEx
DjAMBgNVBAMMBUFkbWluMRIwEAYDVQQKDAlCbG9ja0FwcHMxCzAJBgNVBAYMAlVT
MB4XDTI1MDUxNTE0Mjk1MloXDTI2MDUxNTE0Mjk1MlowNDEQMA4GA1UEAwwHTm9k
ZVR3bzESMBAGA1UECgwJQmxvY2tBcHBzMQwwCgYDVQQGDANVU0EwVjAQBgcqhkjO
PQIBBgUrgQQACgNCAASobiZDnC7/IdKUhfQD4K1jVDoupIect8ef7YZfouO+M983
SlkBocgAeyeJK/Vy3sIfHTLQJ/VGf7iRO7IQMNmtMAwGCCqGSM49BAMCBQADSAAw
RQIhAPB8MojJY+jog/NR4WW9v1N84+U9RJNGchT7k5hYwHPTAiBPlBPRzIk6bgJC
oQgzpu+NG15D2ufaK7FT2d1W+GxHAA==
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIB7DCCAZICFEMvKtLHnafAC+NtPyE602XbANjXMAoGCCqGSM49BAMCMHoxCzAJ
BgNVBAYTAlVTMREwDwYDVQQIDAhOZXcgWW9yazERMA8GA1UEBwwIQnJvb2tseW4x
EjAQBgNVBAoMCUJsb2NrQXBwczEOMAwGA1UEAwwFQWRtaW4xITAfBgkqhkiG9w0B
CQEWEmluZm9AYmxvY2thcHBzLm5ldDAeFw0yNTA1MTUxNDEyNDFaFw0yNTA2MTQx
NDEyNDFaMHoxCzAJBgNVBAYTAlVTMREwDwYDVQQIDAhOZXcgWW9yazERMA8GA1UE
BwwIQnJvb2tseW4xEjAQBgNVBAoMCUJsb2NrQXBwczEOMAwGA1UEAwwFQWRtaW4x
ITAfBgkqhkiG9w0BCQEWEmluZm9AYmxvY2thcHBzLm5ldDBWMBAGByqGSM49AgEG
BSuBBAAKA0IABDzHJIjkUFUq2gjFGtYGxphacY5KkS2CIJdYMDz8Q17nTmxaeKhN
WzZSXO1OJ9pGV+XmogflsPbcUhM1nxbf/HAwCgYIKoZIzj0EAwIDSAAwRQIgC36s
XYTtgQ7oC680AwflmbaqdBXES0NF9R+bWZksaSgCIQDKVknO52m6244djL3EvZ1d
6usbU2KkC+E57SI0rU13rQ==
-----END CERTIFICATE-----|],

-- CN = NodeThree, O = BlockApps, OU = '', C = USA
    [r|-----BEGIN CERTIFICATE-----
MIIBYzCCAQigAwIBAgIQNRQNWAuhdo3fZjocjU1kEDAMBggqhkjOPQQDAgUAMDEx
DjAMBgNVBAMMBUFkbWluMRIwEAYDVQQKDAlCbG9ja0FwcHMxCzAJBgNVBAYMAlVT
MB4XDTI1MDUxNTE0MzAwMVoXDTI2MDUxNTE0MzAwMVowNjESMBAGA1UEAwwJTm9k
ZVRocmVlMRIwEAYDVQQKDAlCbG9ja0FwcHMxDDAKBgNVBAYMA1VTQTBWMBAGByqG
SM49AgEGBSuBBAAKA0IABAiiPSINWtkR88fE12J9Uio2PGtMpgOOBHb9OemmWiM4
M6Q6uJGdCUJzYd4s73aKTpTrDDfmyTka8ena3pql1fwwDAYIKoZIzj0EAwIFAANH
ADBEAiB7EDnkDt43t4ooXX3eDR8VpeROvK23K5wpRyvu5a3wswIgByWDLnse+vjR
LDOfa6IqkNqXlsKPf48L7EeV2flRVzs=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIB7DCCAZICFEMvKtLHnafAC+NtPyE602XbANjXMAoGCCqGSM49BAMCMHoxCzAJ
BgNVBAYTAlVTMREwDwYDVQQIDAhOZXcgWW9yazERMA8GA1UEBwwIQnJvb2tseW4x
EjAQBgNVBAoMCUJsb2NrQXBwczEOMAwGA1UEAwwFQWRtaW4xITAfBgkqhkiG9w0B
CQEWEmluZm9AYmxvY2thcHBzLm5ldDAeFw0yNTA1MTUxNDEyNDFaFw0yNTA2MTQx
NDEyNDFaMHoxCzAJBgNVBAYTAlVTMREwDwYDVQQIDAhOZXcgWW9yazERMA8GA1UE
BwwIQnJvb2tseW4xEjAQBgNVBAoMCUJsb2NrQXBwczEOMAwGA1UEAwwFQWRtaW4x
ITAfBgkqhkiG9w0BCQEWEmluZm9AYmxvY2thcHBzLm5ldDBWMBAGByqGSM49AgEG
BSuBBAAKA0IABDzHJIjkUFUq2gjFGtYGxphacY5KkS2CIJdYMDz8Q17nTmxaeKhN
WzZSXO1OJ9pGV+XmogflsPbcUhM1nxbf/HAwCgYIKoZIzj0EAwIDSAAwRQIgC36s
XYTtgQ7oC680AwflmbaqdBXES0NF9R+bWZksaSgCIQDKVknO52m6244djL3EvZ1d
6usbU2KkC+E57SI0rU13rQ==
-----END CERTIFICATE-----|],

-- CN = NodeFour, O = BlockApps, OU = '', C = USA
    [r|
-----BEGIN CERTIFICATE-----
MIIBYzCCAQigAwIBAgIRALSRHPs/LhpdHY59Zgtp7W8wDAYIKoZIzj0EAwIFADAx
MQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMQswCQYDVQQGDAJV
UzAeFw0yNTA1MTUxNDMwMDdaFw0yNjA1MTUxNDMwMDdaMDUxETAPBgNVBAMMCE5v
ZGVGb3VyMRIwEAYDVQQKDAlCbG9ja0FwcHMxDDAKBgNVBAYMA1VTQTBWMBAGByqG
SM49AgEGBSuBBAAKA0IABLwIcqxa1nB+W3gJ+Y7ajiK8tXFSp+frERHxIXbEWF5g
qu01rIsy3eBwpyBkoLO/uNgYeJSOALc3G2XyNWT97PEwDAYIKoZIzj0EAwIFAANH
ADBEAiBx7+CeXKcdDpVuyR3HrNxkUhMg1qlRQrUcdR/JrzaasgIgTTYspF2KrcFe
/xizVFvu46tyqPqKC3LreOAKlm7XbDY=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIB7DCCAZICFEMvKtLHnafAC+NtPyE602XbANjXMAoGCCqGSM49BAMCMHoxCzAJ
BgNVBAYTAlVTMREwDwYDVQQIDAhOZXcgWW9yazERMA8GA1UEBwwIQnJvb2tseW4x
EjAQBgNVBAoMCUJsb2NrQXBwczEOMAwGA1UEAwwFQWRtaW4xITAfBgkqhkiG9w0B
CQEWEmluZm9AYmxvY2thcHBzLm5ldDAeFw0yNTA1MTUxNDEyNDFaFw0yNTA2MTQx
NDEyNDFaMHoxCzAJBgNVBAYTAlVTMREwDwYDVQQIDAhOZXcgWW9yazERMA8GA1UE
BwwIQnJvb2tseW4xEjAQBgNVBAoMCUJsb2NrQXBwczEOMAwGA1UEAwwFQWRtaW4x
ITAfBgkqhkiG9w0BCQEWEmluZm9AYmxvY2thcHBzLm5ldDBWMBAGByqGSM49AgEG
BSuBBAAKA0IABDzHJIjkUFUq2gjFGtYGxphacY5KkS2CIJdYMDz8Q17nTmxaeKhN
WzZSXO1OJ9pGV+XmogflsPbcUhM1nxbf/HAwCgYIKoZIzj0EAwIDSAAwRQIgC36s
XYTtgQ7oC680AwflmbaqdBXES0NF9R+bWZksaSgCIQDKVknO52m6244djL3EvZ1d
6usbU2KkC+E57SI0rU13rQ==
-----END CERTIFICATE-----|],

-- CN = BlockApps Support, O = BlockApps, OU = Mercata, C = USA
    [r|-----BEGIN CERTIFICATE-----
MIIBlTCCATmgAwIBAgIQNLtR7aw6HT2b1aWtMAn8rDAMBggqhkjOPQQDAgUAMEgx
DjAMBgNVBAMMBUFkbWluMRIwEAYDVQQKDAlCbG9ja0FwcHMxFDASBgNVBAsMC0Vu
Z2luZWVyaW5nMQwwCgYDVQQGDANVU0EwHhcNMjMwMjEwMjEyNDQxWhcNMjQwMjEw
MjEyNDQxWjBQMRowGAYDVQQDDBFCbG9ja0FwcHMgU3VwcG9ydDESMBAGA1UECgwJ
QmxvY2tBcHBzMRAwDgYDVQQLDAdNZXJjYXRhMQwwCgYDVQQGDANVU0EwVjAQBgcq
hkjOPQIBBgUrgQQACgNCAAS5CIUFfyjuaqy0vmYA8xV1gJxLvl+aebJlmhiSiGtG
5fal30YxF91UsW60HCgBAYYw3AklvwP9nht9uvLza3FFMAwGCCqGSM49BAMCBQAD
SAAwRQIhAJj4MF5prxqWC0kcDIdgOpRSLQYmm4jP9gJLKOYbbVDiAiANZS8R6cUw
Rm5K1h2sVZ9HTaIRIfjBRBKIibp+4iMzFA==
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI
MQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF
bmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy
MDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU
MBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG
BSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs
9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8
R0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n
N8txKc8G9R27ZYAUuz15zF0=
-----END CERTIFICATE-----|],

-- CN = bluecabinet, O = , OU = , C = USA
    [r|-----BEGIN CERTIFICATE-----
MIIBfzCCASOgAwIBAgIQF49o4AFxGRC6GG+JiwMURjAMBggqhkjOPQQDAgUAMEgx
DjAMBgNVBAMMBUFkbWluMRIwEAYDVQQKDAlCbG9ja0FwcHMxFDASBgNVBAsMC0Vu
Z2luZWVyaW5nMQwwCgYDVQQGDANVU0EwHhcNMjUwMjI0MTcwNDE5WhcNMjYwMjI0
MTcwNDE5WjA6MRQwEgYDVQQDDAtibHVlY2FiaW5ldDEJMAcGA1UECgwAMQkwBwYD
VQQLDAAxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEGBSuBBAAKA0IABIuYFiLJ
QDx6bLjKC/cw3yiTi1sn3mIYQjBveqZySE4NVPGzmgxRT5dvmuwScakuJ6fA4xzV
R7bnJCGWKtcJi7kwDAYIKoZIzj0EAwIFAANIADBFAiEA9vYdITQp13cmIN/FwHgj
vvbIRZntIhq55Rslqff3P2kCIHbFEzHM9Uo45JNYlDV+REN3dAdNtt/ixRazP8pP
Bsgc
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI
MQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF
bmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy
MDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU
MBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG
BSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs
9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8
R0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n
N8txKc8G9R27ZYAUuz15zF0=
-----END CERTIFICATE-----|],

-- CN = marketplace.mercata-beta.blockapps.net, O = , OU = , C = USA
    [r|-----BEGIN CERTIFICATE-----
MIIBmjCCAT+gAwIBAgIRAOzc3Ut+AEuWgwL0Fjc8zBowDAYIKoZIzj0EAwIFADBI
MQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF
bmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTI1MDIyNTE4MjIyNFoXDTI2MDIy
NTE4MjIyNFowVTEvMC0GA1UEAwwmbWFya2V0cGxhY2UubWVyY2F0YS1iZXRhLmJs
b2NrYXBwcy5uZXQxCTAHBgNVBAoMADEJMAcGA1UECwwAMQwwCgYDVQQGDANVU0Ew
VjAQBgcqhkjOPQIBBgUrgQQACgNCAATigjD52C5DIWVl5uS8eNoLMuXUJiXL2mDD
PcQIAiF+ryaogjblSqSFNOhn15/OafxG7K6eowju+MGnriHfnqFnMAwGCCqGSM49
BAMCBQADRwAwRAIgKYG8AFJUPiqtqmnS4LEIjAcdm/jK3KedvqQpMq9EtysCIBgd
zd8Dik7B0ycwiDefUpeJDy1ghkmQhyGlTxy8KncT
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI
MQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF
bmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy
MDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU
MBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG
BSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs
9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8
R0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n
N8txKc8G9R27ZYAUuz15zF0=
-----END CERTIFICATE-----|],

-- CN = blockchainhaberdasher.com, O = , OU = , C = USA
    [r|-----BEGIN CERTIFICATE-----
MIIBjTCCATKgAwIBAgIRAKRowU1NIzCBWOYbKCKB44MwDAYIKoZIzj0EAwIFADBI
MQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF
bmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTI1MDIyNTE4MjYwM1oXDTI2MDIy
NTE4MjYwM1owSDEiMCAGA1UEAwwZYmxvY2tjaGFpbmhhYmVyZGFzaGVyLmNvbTEJ
MAcGA1UECgwAMQkwBwYDVQQLDAAxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG
BSuBBAAKA0IABKTRDAYNBjGD7cJCo6ZtXiCRKWEnx2UUPHAxISxFTb3tEfbKtt9p
PHZ6sMam13XEIHVl8U8e9HhvuF16TSivMcYwDAYIKoZIzj0EAwIFAANHADBEAiB1
qP0lXE5u2r2njBi+Zhljrhwc52TMC8Qd5Adjn61CDQIgIL1M7W8hkovoaL/N+Adg
SN6KH3WvzQGvSGxx5BvHDlw=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI
MQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF
bmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy
MDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU
MBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG
BSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs
9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8
R0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n
N8txKc8G9R27ZYAUuz15zF0=
-----END CERTIFICATE-----|],

-- CN = James Hormuzdiar, O = BlockApps, OU = Mercata, C = USA
    [r|-----BEGIN CERTIFICATE-----
MIIBlDCCATmgAwIBAgIRAONoCiIj9xpreISmwsFc51swDAYIKoZIzj0EAwIFADBI
MQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF
bmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTI0MDMyNzE4MTkyMloXDTI1MDMy
NzE4MTkyMlowTzEZMBcGA1UEAwwQSmFtZXMgSG9ybXV6ZGlhcjESMBAGA1UECgwJ
QmxvY2tBcHBzMRAwDgYDVQQLDAdNZXJjYXRhMQwwCgYDVQQGDANVU0EwVjAQBgcq
hkjOPQIBBgUrgQQACgNCAAQ9/NgiEiijfL9OwiJGHcmREwab1ZYtoaHM+0BQL/XE
4ZulpnIJcwldfP8aF2bVHYH0sHCq0aivW6rqWD+9y0h3MAwGCCqGSM49BAMCBQAD
RwAwRAIgcDbUcqxKMDtoPn2uQN0CWw9tDdDSPRBrPIxjGJt/wuwCIFSRoZiC3oBl
R9jT4ariCBYb8CTDYBi62EbyJzi3RMAj
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI
MQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF
bmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy
MDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU
MBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG
BSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs
9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8
R0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n
N8txKc8G9R27ZYAUuz15zF0=
-----END CERTIFICATE-----|],

-- CN = BlockApps, O = BlockApps, OU = '', C = ''
    [r|-----BEGIN CERTIFICATE-----
MIIBgjCCASegAwIBAgIQP3LNH8vr+118O6J/CIP78jAMBggqhkjOPQQDAgUAMEgx
DjAMBgNVBAMMBUFkbWluMRIwEAYDVQQKDAlCbG9ja0FwcHMxFDASBgNVBAsMC0Vu
Z2luZWVyaW5nMQwwCgYDVQQGDANVU0EwHhcNMjQwNDIzMTcwNzI0WhcNMjUwNDIz
MTcwNzI0WjA+MRIwEAYDVQQDDAlCbG9ja0FwcHMxEjAQBgNVBAoMCUJsb2NrQXBw
czEJMAcGA1UECwwAMQkwBwYDVQQGDAAwVjAQBgcqhkjOPQIBBgUrgQQACgNCAATf
31hXrACSTv/8cNMI0tWeA0GOtrh2rSg7ssDhbduFZvoMIDD50CDKMdknVcWDbMN6
rrmTpNpDx+lwiQA3fNsTMAwGCCqGSM49BAMCBQADRwAwRAIgZ6z4c630p5S4ubC3
FnsaXJsWsGrXKNZbaZMeUfRBYugCIGAFGgSqW1PSoLvwXeK1ih9BBjyKFpW+PlE/
jtQJMv3t
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI
MQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF
bmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy
MDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU
MBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG
BSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs
9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8
R0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n
N8txKc8G9R27ZYAUuz15zF0=
-----END CERTIFICATE-----|],

-- CN = dnorwood-personal, O = Mercata Account d1ce262af, OU = '', C = ''
    [r|-----BEGIN CERTIFICATE-----
MIIBhTCCASmgAwIBAgIQJAvYwPpzGED65EyJ5Cg42jAMBggqhkjOPQQDAgUAMEgx
DjAMBgNVBAMMBUFkbWluMRIwEAYDVQQKDAlCbG9ja0FwcHMxFDASBgNVBAsMC0Vu
Z2luZWVyaW5nMQwwCgYDVQQGDANVU0EwHhcNMjQwMzI2MTk0MTMzWhcNMjUwMzI2
MTk0MTMzWjBAMRowGAYDVQQDDBFkbm9yd29vZC1wZXJzb25hbDEiMCAGA1UECgwZ
TWVyY2F0YSBBY2NvdW50IGQxY2UyNjJhZjBWMBAGByqGSM49AgEGBSuBBAAKA0IA
BKVNGLs80o4HLkJawrDC/Bf10mtxGoPT04BPTVCOQZapfLvuDSPTZpPGr7yFgzuF
mMYI3mqvkhhwQJL9DxKBrtcwDAYIKoZIzj0EAwIFAANIADBFAiEAwZg2LRxnvXT0
i8vNXdiMuAG+y8U9itaUXRM1iUG2olYCIHt+KODJIBTRy2e0LsIIPJI8dX3p8gVs
99HonTEOziXy
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI
MQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF
bmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy
MDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU
MBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG
BSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs
9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8
R0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n
N8txKc8G9R27ZYAUuz15zF0=
-----END CERTIFICATE-----|],

-- CN = gotan, O = BlockApps, OU = '', C = ''
    [r|-----BEGIN CERTIFICATE-----
MIIBajCCAQ6gAwIBAgIRAOxcR4q96wNTjpqVNYSI8rIwDAYIKoZIzj0EAwIFADBI
MQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF
bmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTI0MDgxNTE5NTE0NFoXDTI1MDgx
NTE5NTE0NFowJDEOMAwGA1UEAwwFZ290YW4xEjAQBgNVBAoMCUJsb2NrQXBwczBW
MBAGByqGSM49AgEGBSuBBAAKA0IABDQUTuESFIQQEPZa38l/ShY1MO+eaFK7sXv/
phDUCMQWK2XTl7p8qBtQZO7gtEBmxNXG3KIWg6s4CYt7s3FOxVwwDAYIKoZIzj0E
AwIFAANIADBFAiEAxrawRiWvN+F6cSNc4TG26O9CHVUIbyC/k3WcDxaK7t4CIGi2
S/u4WZO1JqHQdIysBA2MlBUZbssxWKcjBqKqBTLJ
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIBjTCCATKgAwIBAgIRAOPPkVoBp/GnwZGR32jcIjwwDAYIKoZIzj0EAwIFADBI
MQ4wDAYDVQQDDAVBZG1pbjESMBAGA1UECgwJQmxvY2tBcHBzMRQwEgYDVQQLDAtF
bmdpbmVlcmluZzEMMAoGA1UEBgwDVVNBMB4XDTIyMDQyMDE3NTcxM1oXDTIzMDQy
MDE3NTcxM1owSDEOMAwGA1UEAwwFQWRtaW4xEjAQBgNVBAoMCUJsb2NrQXBwczEU
MBIGA1UECwwLRW5naW5lZXJpbmcxDDAKBgNVBAYMA1VTQTBWMBAGByqGSM49AgEG
BSuBBAAKA0IABFISUeMfsGYl/sWStpv6cDeNHLwktFAO2dAwe7J8uWZzS8ONyYCs
9FEQ2NsmDj5IaCAKcRSvVFNwXOAUQDQ1pnUwDAYIKoZIzj0EAwIFAANHADBEAiA8
R0UERQZbF3qJUt5A0ZFf2ZmB0l/ZPjIvM383gOF3xwIgbxbQ8NLkDEe2mWJ/qa4n
N8txKc8G9R27ZYAUuz15zF0=
-----END CERTIFICATE-----|]
  ]

extraCerts :: [X509Certificate]
extraCerts = map (\s -> either (error $ "can't parse cert: " ++ show s) id $ bytesToCert $ BC.pack s) certStrings

validators :: [Validator]
validators = [
    "NodeOne",
    "NodeTwo",
    "NodeThree",
    "NodeFour"
--  "bluecabinet"
--  "marketplace.mercata-beta.blockapps.net"
--  "blockchainhaberdasher.com"
  ]

admins :: [Text]
admins = [
--  "Kieren James-Lubin",
--  "Victor Wong",
  "James Hormuzdiar"
  ]

