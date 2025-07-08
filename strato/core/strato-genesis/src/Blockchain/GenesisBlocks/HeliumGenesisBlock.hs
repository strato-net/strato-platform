{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes       #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TupleSections     #-}

module Blockchain.GenesisBlocks.HeliumGenesisBlock (
  genesisBlock
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
import           Data.List                                       (find)
import qualified Data.Map.Strict                                 as M
import           Data.Maybe                                      (mapMaybe)
import           Data.Text                                       (Text)
import qualified Data.Text                                       as T
import           Data.Text.Encoding
import           SolidVM.Model.Storable
import           Text.RawString.QQ

gramsToOz :: Integer -> Integer
gramsToOz n = (10000 * n) `div` 283495

assetMap :: M.Map Address GA.Asset
assetMap = foldr (\k -> M.insert (GA.root k) k) M.empty GA.assets

usdstAsset :: GA.Asset
usdstAsset = head $ filter ((== "USDST") . GA.name) GA.assets

usdstAddress :: Address
usdstAddress = GA.root usdstAsset

cataAsset :: GA.Asset
cataAsset = maybe (error "Could not find cataAsset") id $ find ((== "CATA") . GA.name) GA.assets

cataAddress :: Address
cataAddress = GA.root cataAsset

addrBS :: Address -> B.ByteString
addrBS = BC.pack . formatAddressWithoutColor

blockappsAddress :: Address
blockappsAddress = 0x1b7dc206ef2fe3aab27404b88c36470ccf16c0ce --0x0dbb9131d99c8317aa69a70909e124f2e02446e8

goldstRoot :: Address
goldstRoot = 0xcdc93d30182125e05eec985b631c7c61b3f63ff0

goldOunceRoot :: Address
goldOunceRoot = 0xb00e37ca092cb3c2a62d4110154a5e172279e770

goldGramRoot :: Address
goldGramRoot = 0xbc94173470e33deef702c6f45c6bf701d682f58c

silvstRoot :: Address
silvstRoot = 0x2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94

altSilvstRoot :: Address
altSilvstRoot = 0x7b5f6d756c4e02104d5039205442cf7aa913a8a6

mercataAddress :: Address
mercataAddress = 0x1000

rateStrategyAddress :: Address
rateStrategyAddress = 0x1001

priceOracleAddress :: Address
priceOracleAddress = 0x1002

collateralVaultAddress :: Address
collateralVaultAddress = 0x1003

liquidityPoolAddress :: Address
liquidityPoolAddress = 0x1004

lendingPoolAddress :: Address
lendingPoolAddress = 0x1005

poolConfiguratorAddress :: Address
poolConfiguratorAddress = 0x1006

lendingRegistryAddress :: Address
lendingRegistryAddress = 0x1007

mercataEthBridgeAddress :: Address
mercataEthBridgeAddress = 0x1008

onRampAddress :: Address
onRampAddress = 0x1009

poolFactoryAddress :: Address
poolFactoryAddress = 0x100a

tokenFactoryAddress :: Address
tokenFactoryAddress = 0x100b

adminRegistryAddress :: Address
adminRegistryAddress = 0x100c

feeCollectorAddress :: Address
feeCollectorAddress = 0x100d

voucherAddress :: Address
voucherAddress = 0x100e

mTokenAddress :: Address
mTokenAddress = 0x100f

rewardsManagerAddress :: Address
rewardsManagerAddress = 0x1010

baseContractAddresses :: [Address]
baseContractAddresses = [mercataAddress..mTokenAddress]

combinedEscrows :: [GE.Escrow]
combinedEscrows = M.elems
                . foldr (\e -> M.unionWith go $ M.singleton (GE.assetRootAddress e, GE.borrower e) e) M.empty
                . map alloy
                . map correctQ
                $ filter GE.isActive GE.escrows
  where go e1 e2 = e2
          { GE.borrowedAmount = GE.borrowedAmount e1 + GE.borrowedAmount e2
          , GE.collateralQuantity = GE.collateralQuantity e1 + GE.collateralQuantity e2
          }
        alloy e = case GE.assetRootAddress e of
          a | a == goldOunceRoot -> e{ GE.assetRootAddress = goldstRoot }
            | a == goldGramRoot -> e{ GE.assetRootAddress = goldstRoot
                                    , GE.collateralQuantity = gramsToOz $ GE.collateralQuantity e
                                    }
            | a == altSilvstRoot -> e{ GE.assetRootAddress = silvstRoot }
            | otherwise -> e
        correctQ e = case M.lookup (GE.assetRootAddress e) assetMap of
          Nothing -> e
          Just GA.Asset{..} -> e{ GE.collateralQuantity = correctQuantity decimals name (GE.collateralQuantity e) }

genesisBlock :: GenesisInfo
genesisBlock  =
  insertMercataGovernanceContract validators admins
  . insertDecideContract
  . insertCertRegistryContract extraCerts
  $ defaultGenesisInfo{
        genesisInfoDifficulty=8192,
        genesisInfoLogBloom=B.replicate 256 0,
        genesisInfoGasLimit=22517998136852480000000000000000,
        genesisInfoCoinbase=Org "00000000000000000000" True,
        genesisInfoAccountInfo=[
            NonContract 0xe1fd0d4a52b75a694de8b55528ad48e2e2cf7859 1809251394333065553493296640760748560207343510400633813116524750123642650624,
            SolidVMContractWithStorage
              mercataAddress
              720
              (SolidVMCode "Mercata" (KECCAK256.hash $ BL.toStrict $ JSON.encode mercataContracts))
              [ (".:creator", BString $ encodeUtf8 "BlockApps")
              , (".:creatorAddress", BAccount $ unspecifiedChain blockappsAddress)
              , (".:originAddress", BAccount $ unspecifiedChain mercataAddress)
              , (".rateStrategy", BContract "RateStrategy" $ unspecifiedChain rateStrategyAddress)
              , (".priceOracle", BContract "PriceOracle" $ unspecifiedChain priceOracleAddress)
              , (".collateralVault", BContract "CollateralVault" $ unspecifiedChain collateralVaultAddress)
              , (".liquidityPool", BContract "LiquidityPool" $ unspecifiedChain liquidityPoolAddress)
              , (".lendingPool", BContract "LendingPool" $ unspecifiedChain lendingPoolAddress)
              , (".poolConfigurator", BContract "PoolConfigurator" $ unspecifiedChain poolConfiguratorAddress)
              , (".lendingRegistry", BContract "LendingRegistry" $ unspecifiedChain lendingRegistryAddress)
              , (".mercataEthBridge", BContract "MercataEthBridge" $ unspecifiedChain mercataEthBridgeAddress)
              , (".onRamp", BContract "OnRamp" $ unspecifiedChain onRampAddress)
              , (".poolFactory", BContract "PoolFactory" $ unspecifiedChain poolFactoryAddress)
              , (".tokenFactory", BContract "TokenFactory" $ unspecifiedChain tokenFactoryAddress)
              , (".feeCollector", BContract "FeeCollector" $ unspecifiedChain feeCollectorAddress)
              , (".adminRegistry", BContract "AdminRegistry" $ unspecifiedChain adminRegistryAddress)
              , (".rewardsManager", BContract "RewardsManager" $ unspecifiedChain rewardsManagerAddress)
              ]
            ] ++ mapMaybe assetToAccountInfos GA.assets ++
            [ rateStrategy
            , priceOracle
            , collateralVault
            , liquidityPool
            , lendingPool
            , poolConfigurator
            , lendingRegistry
            , mercataEthBridge
            , onRamp
            , poolFactory
            , tokenFactory
            , adminRegistry
            , feeCollector
            , voucher
            , mToken
            , rewardsManager
            ],
        genesisInfoCodeInfo=[CodeInfo (decodeUtf8 $ BL.toStrict $ JSON.encode mercataContracts) (Just "Mercata")]
        }

createdByBlockApps :: Address -> [(B.ByteString, BasicValue)]
createdByBlockApps originAddress =
  [ (".:creator", BString $ encodeUtf8 "BlockApps")
  , (".:creatorAddress", BAccount $ unspecifiedChain blockappsAddress)
  , (".:originAddress", BAccount $ unspecifiedChain originAddress)
  ]

ownedByBlockApps :: Address -> [(B.ByteString, BasicValue)]
ownedByBlockApps originAddress = ("._owner", BAccount $ unspecifiedChain blockappsAddress) : createdByBlockApps originAddress

getDecimals :: Integer -> Text -> Integer
getDecimals d n =
  if d < 0 || d >= 18 || n `elem` ["CATA", "ETHST", "USDTEMP", "BETHTEMP"]
    then 18
    else if n == "STRAT"
           then 4
           else d

correctQuantity :: Integer -> Text -> Integer -> Integer
correctQuantity d n q =
  let times10ToThe a b = foldr (*) a $ replicate b 10
      decs = getDecimals d n
   in q `times10ToThe` (fromIntegral $ 18 - decs)

assetToAccountInfos :: GA.Asset -> Maybe AccountInfo
assetToAccountInfos GA.Asset{..} =
  let accountBalances' = concatMap
        (\case
          (GA.Balance _ o c q)
            | root == usdstAddress &&  c == "mercata_usdst" ->
                [(liquidityPoolAddress, correctQuantity decimals name q),
                 (blockappsAddress, correctQuantity decimals name q)]
            | root == goldstRoot ->
                let goldstBalance = correctQuantity decimals name q
                    goldOzBalance = maybe 0 (\a -> maybe 0 (\b -> correctQuantity (GA.decimals a) (GA.name a) (GA.quantity b)) . M.lookup o $ GA.balances a) $ M.lookup goldOunceRoot assetMap
                    goldGmBalance = maybe 0 (\a -> maybe 0 (\b -> gramsToOz $ correctQuantity (GA.decimals a) (GA.name a) (GA.quantity b)) . M.lookup o $ GA.balances a) $ M.lookup goldGramRoot assetMap
                 in [(o, goldstBalance + goldOzBalance + goldGmBalance)]
            | root == goldOunceRoot -> []
            | root == goldGramRoot -> []
            | root == silvstRoot ->
                let silvstBalance = correctQuantity decimals name q
                    altSilvstBalance = maybe 0 (\a -> maybe 0 (\b -> correctQuantity (GA.decimals a) (GA.name a) (GA.quantity b)) . M.lookup o $ GA.balances a) $ M.lookup altSilvstRoot assetMap
                 in [(o, silvstBalance + altSilvstBalance)]
            | root == altSilvstRoot -> []
            | otherwise ->
                [(o, correctQuantity decimals name q)]
        ) . filter ((>0) . GA.quantity) $ M.elems balances
      accountBalances = (\(a, b) -> ("._balances<a:" <> addrBS a <> ">", BInteger b)) <$> accountBalances'
      contractBalances = if root == usdstAddress then (\a -> ("._balances<a:" <> addrBS a <> ">", BInteger $ correctQuantity 0 name 100000)) <$> baseContractAddresses else []
      allBalances = accountBalances ++ contractBalances
      takeCaps = T.pack . filter (\c -> (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) . T.unpack
   in case allBalances of
        [] -> Nothing
        _ -> Just . SolidVMContractWithStorage root 0 (CodeAtAccount mercataAddress "Token") $
          ownedByBlockApps root ++
          [ ("._name", if root == silvstRoot then BString "SILVST" else BString $ encodeUtf8 name)
          , ("._symbol", if root == silvstRoot then BString "SILVST" else BString $ encodeUtf8 $ takeCaps name)
          , (".description", BString $ encodeUtf8 description)
          , (".customDecimals", BInteger 18)
          , ("._totalSupply", BInteger . sum $ (\(_, v) -> case v of BInteger i -> i; _ -> 0) <$> allBalances)
          , (".minters<a:" <> addrBS blockappsAddress <> ">", BBool True)
          , (".burners<a:" <> addrBS blockappsAddress <> ">", BBool True)
          , (".admin", BAccount $ unspecifiedChain blockappsAddress)
          , (".tokenFactory", BContract "TokenFactory" $ unspecifiedChain tokenFactoryAddress)
          , (".images.length", BInteger . fromIntegral $ length images)
          , (".files.length", BInteger . fromIntegral $ length files)
          , (".fileNames.length", BInteger . fromIntegral $ length fileNames)
          ] ++ map (\(k,v) -> (".images[" <> encodeUtf8 (T.pack $ show k) <> "]", BString $ encodeUtf8 v)) (M.toList images)
            ++ map (\(k,v) -> (".files[" <> encodeUtf8 (T.pack $ show k) <> "]", BString $ encodeUtf8 v)) (M.toList files)
            ++ map (\(k,v) -> (".fileNames[" <> encodeUtf8 (T.pack $ show k) <> "]", BString $ encodeUtf8 v)) (M.toList fileNames)
            ++ map (\(k,v) -> (".attributes<" <> encodeUtf8 (T.pack $ show k) <> ">", BString $ encodeUtf8 v)) (M.toList assetData)
            ++ [(maybe (".status", if root == usdstAddress then BEnumVal "TokenStatus" "ACTIVE" 2 else BEnumVal "TokenStatus" "LEGACY" 3) (const (".status", BEnumVal "TokenStatus" "ACTIVE" 2)) $ find ((== root) . GR.assetRootAddress) GR.reserves)]
            ++ [(".rewardsManager", BContract "RewardsManager" $ unspecifiedChain (maybe 0x0 (const rewardsManagerAddress) $ find ((== root) . GR.assetRootAddress) GR.reserves))]
            ++ accountBalances
            ++ contractBalances
            ++ existingTestnetBalances
  where existingTestnetBalances = 
          [ (".balances<a:0000000000000000000000000000000000001000>", BInteger 100000000000000000000000),
            (".balances<a:0000000000000000000000000000000000001001>", BInteger 100000000000000000000000),
            (".balances<a:0000000000000000000000000000000000001002>", BInteger 100000000000000000000000),
            (".balances<a:0000000000000000000000000000000000001003>", BInteger 100000000000000000000000),
            (".balances<a:0000000000000000000000000000000000001004>", BInteger 110175440000000000000000),
            (".balances<a:0000000000000000000000000000000000001005>", BInteger 100000000000000000000000),
            (".balances<a:0000000000000000000000000000000000001006>", BInteger 100000000000000000000000),
            (".balances<a:0000000000000000000000000000000000001007>", BInteger 100000000000000000000000),
            (".balances<a:0000000000000000000000000000000000001008>", BInteger 100000000000000000000000),
            (".balances<a:0000000000000000000000000000000000001009>", BInteger 100000000000000000000000),
            (".balances<a:000000000000000000000000000000000000100a>", BInteger 100000000000000000000000),
            (".balances<a:000000000000000000000000000000000000100b>", BInteger 100000000000000000000000),
            (".balances<a:000000000000000000000000000000000000100c>", BInteger 100000000000000000000000),
            (".balances<a:000000000000000000000000000000000000100d>", BInteger 100002547000000000000000),
            (".balances<a:000000000000000000000000000000000000100e>", BInteger 100000000000000000000000),
            (".balances<a:000000000000000000000000000000000000100f>", BInteger 100000000000000000000000),
            (".balances<a:0000000000000000000000000000000000001234>", BInteger 1780000000000000000),
            (".balances<a:0073a47a21a1e02d5646f0788ea03b925bbe3d4d>", BInteger 1000000000000000000),
            (".balances<a:02a9188f2363f437a9aff56884bfc7ceb43ab78a>", BInteger 3000000000000000000),
            (".balances<a:030d87139fbb5187bd6e0976ba3fa7dbea58f261>", BInteger 1000000000000000000),
            (".balances<a:032a7e22295949f5a1eb857b9a3019b29a0a91c4>", BInteger 904000000000000000),
            (".balances<a:034fc9b3483d0d5e9d8ace9873cc187993e2c34f>", BInteger 1000000000000000000),
            (".balances<a:04b13dbbd1dd954c5d9cfc7dd3e97f80d125b5f3>", BInteger 500000000000000000),
            (".balances<a:05588ccbceff65805b9fb10011ab2f03adff1e00>", BInteger 16510000000000000000),
            (".balances<a:06644a13373b1b1a71a19035dafe8be83f894537>", BInteger 1000000000000000000),
            (".balances<a:06aeb6095a4e61ce1dfdfee4e71d9e5ebf56d07f>", BInteger 2200000000000000000),
            (".balances<a:06caf5fd07a8e1b485834273fbac00143e0e56cd>", BInteger 180100000000000000000),
            (".balances<a:07048fa5c3107c08a5e4cc6e8cd1a4acefeee8d4>", BInteger 1000000000000000000000),
            (".balances<a:071cd50ee7bde647bd5157a5a750b7f7fe70de7d>", BInteger 1000000000000000000),
            (".balances<a:0796a15c9c7cc1ff2648e0c60e5ccadf07475b9c>", BInteger 4000000000000000000),
            (".balances<a:07d5c2361f3c75f5646490914a0d71001e1652dc>", BInteger 331796600000000032768),
            (".balances<a:07f26fb2c6c8430cfd606c55bb2f7ae8fcc1f2c2>", BInteger 4510000000000000000),
            (".balances<a:095fb23bc1ed2b0eeb730ecb8927d34a3cb2254d>", BInteger 1000000000000000000000),
            (".balances<a:099e0a2132077622fe0a3edd6363dafd8d91e0b8>", BInteger 200000000000000000),
            (".balances<a:09f206d70ccad831e316aefeaca062e8dff1b94d>", BInteger 1200000000000000000),
            (".balances<a:0b21bbe37ebd5d5e72ac624cbcd857c6e2971482>", BInteger 43245400000000000000),
            (".balances<a:0ca06d09436952ef8731de4b1ab47f14b2ece766>", BInteger 2000000000000000000),
            (".balances<a:0d3fab6a0596a6322a8a60c04cf110217556d763>", BInteger 1000000000000000000),
            (".balances<a:0dbb9131d99c8317aa69a70909e124f2e02446e8>", BInteger 1406469636959183347213824),
            (".balances<a:0dbc4793a98a5401af9d9586c865f872cffe3f24>", BInteger 4000000000000000000),
            (".balances<a:0ecb9c15e2ca8f78c7381750873cb39b2f787d03>", BInteger 1000000000000000000),
            (".balances<a:0f147421eeeb0913d43f16294fbbf16dcd6c5138>", BInteger 5000000000000000000),
            (".balances<a:0fff95ad025df7bee07df5611577ba4c9ca27101>", BInteger 1000000000000000000),
            (".balances<a:101a31a25295a5dd95187ea2b0725c91443db7b7>", BInteger 4531373491077320597336),
            (".balances<a:10ed1825dc2e5fe0782d9cc21d50598852fd2e32>", BInteger 4200000000000000000),
            (".balances<a:1105a47fcd627bb4b9ad5e801936fbd76710616b>", BInteger 1000000000000000000),
            (".balances<a:113251c4f4707e2daa420422e28066af497a59d4>", BInteger 2000000000000000000),
            (".balances<a:1244ac7e4f6029d4fcb3a9ee284e974aa7562fa0>", BInteger 1000000000000000000),
            (".balances<a:129f0ffc6aa193763bcc9e2dc7f3dd5e859b54ce>", BInteger 1000000000000000000),
            (".balances<a:12e2798583f1716ca86e81418be291cd09deaf10>", BInteger 500000000000000000),
            (".balances<a:1324b8aee0ab0863621bfb59a9d8d9a9a89d9f0b>", BInteger 1000000000000000000),
            (".balances<a:139806ec952da533514f7b748e3861d6bf11f523>", BInteger 200000000000000000),
            (".balances<a:141e73dc8d2dbbda4fba3797527d22be4b2c4744>", BInteger 34990931616934999220234),
            (".balances<a:144ea2d656e9b6accb7099d7822164790e72adaa>", BInteger 2000000000000000000),
            (".balances<a:1500a5d3af1864d29280a6ff2a48b9ac03357c46>", BInteger 2000000000000000000),
            (".balances<a:160b6e5c0ac583ba54c8c5b069fa3a503762ab33>", BInteger 245000000000000000000),
            (".balances<a:16b52a634fa40c8147dd367302616d83d138b8e8>", BInteger 1200000000000000000),
            (".balances<a:1827a7830f260bc1335d6b45060133ea689a2316>", BInteger 2000000000000000000),
            (".balances<a:18808e14420ca053f37a90615a8a241a85c8ac3f>", BInteger 1000000000000000000),
            (".balances<a:189f1254fcb3adad4bc2697fecb282716de4fdef>", BInteger 6500000000000000000),
            (".balances<a:18c8f14bbb71f7c88e880a9b521e7b7de153d226>", BInteger 1000000000000000000),
            (".balances<a:18ebbe996c575443421d9915e5d71849d0d822ec>", BInteger 1000000000000000000),
            (".balances<a:18fec20e24bdff6c955f666cad251d3ac3c5de43>", BInteger 94200000000000000000),
            (".balances<a:1901c80b8f9e2f737ccfa24ea2ceda7041e1523b>", BInteger 2200000000000000000),
            (".balances<a:192dc8ca71f0e5d64f05e263e37817a9b9b43aa5>", BInteger 2000000000000000000),
            (".balances<a:1ae15194748b9f8128d6fe41f782a4ab16c0aca7>", BInteger 1000000000000000000),
            (".balances<a:1af47861d6866623a91444394820d11f5febb20c>", BInteger 1000000000000000000),
            (".balances<a:1b7dc206ef2fe3aab27404b88c36470ccf16c0ce>", BInteger 1030754789999999999965536),
            (".balances<a:1cea896042b613b22d95e6e3f9855afb2aba2d04>", BInteger 7978200000000000),
            (".balances<a:1d544f1230e3c485a1178689e7c19ba8e769865c>", BInteger 924276000000000000),
            (".balances<a:1f5b2deada9c7060f274c61b9de20a893ba25009>", BInteger 3000000000000000000),
            (".balances<a:1ffaa1eaab6bc10f81e6f75d6cb757927daf8226>", BInteger 3730000000000000000),
            (".balances<a:1ffdd04051bf21708dab291c4d45876302c61705>", BInteger 250000000000000000),
            (".balances<a:208c37c87f0638521f2aa3dab982086d95d6533b>", BInteger 10500000000000000000),
            (".balances<a:212e74340a3021a48c0d4c1d0c1b2d08c31fea68>", BInteger 1000000000000000000),
            (".balances<a:21798147944f7776e599212d62ef3bf136629a46>", BInteger 1000000000000000000),
            (".balances<a:223ca5e520c6cbc5e2ed97d9d7c8f43dc8715b0a>", BInteger 300000000000000000),
            (".balances<a:22b14e500b90f78171e7b4ee97c843ee6c7037e0>", BInteger 77210000000000000000),
            (".balances<a:234f28e313c62115d2814cc243cc7f93ca5acb2c>", BInteger 200000000000000000),
            (".balances<a:246e14b461f76ca6f0aaf3eec1f315261d7cf24e>", BInteger 6520000000000000000),
            (".balances<a:24f41088df6460d9023834ce3ad5607d8677eaab>", BInteger 1000000000000000000),
            (".balances<a:25422f27c67b99152ab76e104e8a8f9211f9dc75>", BInteger 759640000000000000000),
            (".balances<a:25b8eebf67b6cacea3d08af88eb769de6a6e7f60>", BInteger 1000000000000000000),
            (".balances<a:25ed50025304f3182e0d7f5db012312adec44442>", BInteger 3000000000000000000),
            (".balances<a:2629a7e6dcbcbf5cdb03990d5e285c87ac4fe340>", BInteger 7220400000000000000),
            (".balances<a:273f372acf4072874fe1303d99e24a3f4a5cc7bf>", BInteger 500000000000000000),
            (".balances<a:2753eba88b81755da9b596a2a2b9bd7bdfc1aa19>", BInteger 200000000000000000),
            (".balances<a:277f7438d0ba56cd6ce576ef48c8626273f00c5f>", BInteger 2200000000000000000),
            (".balances<a:27e2af094df8d79011f05201c3d1d1e766a72038>", BInteger 2000000000000000000),
            (".balances<a:27e68993f0800a04639baab633a5af85caba86fe>", BInteger 1000000000000000000),
            (".balances<a:280317be9dc42064e5044d2915c4ba4b250507c3>", BInteger 1000000000000000000),
            (".balances<a:288922eb7e5faa72222a859652ef275a1e6817f4>", BInteger 420000000000000000),
            (".balances<a:288d4efa15c4411a1defa17f7097abe53522742f>", BInteger 8500000000000000),
            (".balances<a:2899d3187558ff4e1160c01480d12d7f607ac022>", BInteger 2200000000000000000),
            (".balances<a:28bc8b4856fdc4ef2c43f615825c7ca01c46b1a4>", BInteger 1000000000000000000),
            (".balances<a:296dfe6b02b9d27b7ffe7888a01bf108ff672992>", BInteger 60000000000000000),
            (".balances<a:2a88d81c62f6e71a838bcbeea04c63a0555b4899>", BInteger 500000000000000000),
            (".balances<a:2ab9435ceb22843b4212330fdfda27d5af86300f>", BInteger 4200000000000000000),
            (".balances<a:2b0df7b88ca5e828a227e08db8f135824e6a4f04>", BInteger 4000000000000000000),
            (".balances<a:2baff039ed4cf463b1884ad6576b22108ac6ae03>", BInteger 718590000000000065536),
            (".balances<a:2bf4d13025e30296385395fc00a372fae781fbe3>", BInteger 2000000000000000000),
            (".balances<a:2ccc879a4b83673119e83fd708a183f56222abfc>", BInteger 200000000000000000),
            (".balances<a:2d624b426ccb9d6703d8f6c9c66b7abe89433dbf>", BInteger 1000000000000000000),
            (".balances<a:2dbf7324123d7a42ead588345f425e565a6de073>", BInteger 150000000000000000),
            (".balances<a:2e220b951bc8923f2a7397830ecec87d30f16841>", BInteger 22220000000000000000),
            (".balances<a:2e5d0e164e10753bdafa5b5005c9b15d3a9e42c6>", BInteger 1000000000000000000),
            (".balances<a:2e65db9a7ce2b6f8e68a9d53faba1e5f6adfcf9c>", BInteger 1000000000000000000),
            (".balances<a:2e7b8552c1ec578ab83d1e1cf0b87d5d41d825d2>", BInteger 500000000000000000),
            (".balances<a:2e8850bef31484e978ba8b8a7d2683aacc5cfdff>", BInteger 1000000000000000000),
            (".balances<a:2f7763392a678fd0322f816941d3eb2c52034f2b>", BInteger 500000000000000000),
            (".balances<a:2f7814c1a453f0a99098cb1d7e1bf222dd66518f>", BInteger 500000000000000000),
            (".balances<a:304f41812ce9a1db4fa9c58aff7904ea3e77d51a>", BInteger 200000000000000000),
            (".balances<a:305156bea0ba1ddd461277a8abfc433d1179d01a>", BInteger 1000000000000000000),
            (".balances<a:30ae89ebe37dfa7cac3946a5fee947ebb0b79910>", BInteger 1000000000000000000),
            (".balances<a:30fd36d8491032d79f8571d694b82a9538c650a7>", BInteger 500000000000000000),
            (".balances<a:316976a5719d5605a0e1c25d6320569ad32234bf>", BInteger 5795000000000000000),
            (".balances<a:325f309cd1dfb07ba9faefe147a9da73e3f4ed47>", BInteger 3000000000000000000),
            (".balances<a:3287f1ad89b0ac875b58a65ceaf40bc7a6cc8041>", BInteger 45000000000000000000),
            (".balances<a:34abb01c027558b3c000eccf58b11719a51b5615>", BInteger 13080845899999999950848),
            (".balances<a:34d7caf576cf9493f054d9eced99dcd463eba4b7>", BInteger 10099910000000000000000),
            (".balances<a:34f64294cb0a0800c5f2d340ac050fdf66e0ee1e>", BInteger 1000000000000000000),
            (".balances<a:3501f8650cccb7abc65335e646ccc6937b689eb6>", BInteger 1000000000000000000),
            (".balances<a:3503cd5fe5df29921fae66e79cd70b924c1f41a4>", BInteger 5050000000000000000),
            (".balances<a:3511958fabe4b163ac39f49d21533d7fe3a2cc97>", BInteger 1000000000000000000),
            (".balances<a:3529447b44ad617d40af5fd1f9d40b2b7e9fdc3a>", BInteger 620000000000000000),
            (".balances<a:3560fe7a820704a6b80efe68c79210e4e99aa8f7>", BInteger 5923560000000000000),
            (".balances<a:35acd12edc4329dc70cb13365656701481b85fe5>", BInteger 5000000000000000000),
            (".balances<a:35b9cc3b3ab9f874a0d46a02db3c89e44903cc25>", BInteger 2000000000000000000),
            (".balances<a:35e15133ff756e75c6fae443c563c90af03ea7db>", BInteger 1000000000000000000),
            (".balances<a:3641f2cb1b6371dc1732ad9dfd14e57b685fd018>", BInteger 1000000000000000000),
            (".balances<a:36626ea76ab98ebed1d19d5e00c4feee2a541c88>", BInteger 200000000000000000),
            (".balances<a:37622e17544ba483cb104cee91cd8a746f0268d4>", BInteger 1000000000000000000),
            (".balances<a:37cc2ad621c72f6c1fa6d8f7580b8d53c261afda>", BInteger 1000000000000000000000),
            (".balances<a:383e1809a16bacc63caf177f5fbf95f005359b4b>", BInteger 313929999999999987712),
            (".balances<a:388de1adf9a80fed7dea9f4d69af60b4fde0cd23>", BInteger 10000000000000000000),
            (".balances<a:389691650025897304f615d72eb7cc9dc010f0c9>", BInteger 1000000000000000000),
            (".balances<a:389a7d39ec37eada8c1a9ca4d9a83c4ab2af730d>", BInteger 1000000000000000000),
            (".balances<a:38dddaabc6d336478f7b1b69f3cf39716905bea2>", BInteger 240000000000000000),
            (".balances<a:38f52fcb810be570f31fc7f734f8efee2bd72482>", BInteger 500000000000000000),
            (".balances<a:3919a647ff687f7c87e1b7b80139e2e91b5ac6e8>", BInteger 10000000000000000000),
            (".balances<a:39e3471741be9860a2460cd7179748877482f69a>", BInteger 1000000000000000000),
            (".balances<a:39e5b8c450f1d3c3206415fec5f9acc24e21c266>", BInteger 500000000000000000),
            (".balances<a:3a455da64a23603ac024da5dca2efda792a1c8fb>", BInteger 2000000000000000000),
            (".balances<a:3a66231e36395645d36a2c071b3bea39d8aa3199>", BInteger 225000000000000000000),
            (".balances<a:3b1a452cb7a885dddea15c45403f5b6c3b08de45>", BInteger 2200000000000000000),
            (".balances<a:3bac429bafc2f19f0b1259322f9ff7801f814a93>", BInteger 3000000000000000000),
            (".balances<a:3d0b71377ee3b0aa3fdce6bed4146f2d88642f80>", BInteger 1000000000000000000),
            (".balances<a:3e3ad1e02dc60d8ecebfd15e2289dc6c7c79ff4c>", BInteger 1000000000000000000),
            (".balances<a:3e43c6d12570d90352def7fc45df5002ca18570d>", BInteger 45000000000000000000),
            (".balances<a:3eb0d27387d9aee870184c7c62a7840da7fd6437>", BInteger 1000000000000000000),
            (".balances<a:3f067c66b3cae094ea6e146783aadfa7686cee13>", BInteger 500000000000000000),
            (".balances<a:3f2a2dba17d39a9977be0fca5d12fb94c64b4b6c>", BInteger 1000000000000000000),
            (".balances<a:3f4854a90ca8567c67aa1ff1db0b4749bfa51d7c>", BInteger 1000000000000000000),
            (".balances<a:3f811959b2217ef5f0f1f35405f5220d54563558>", BInteger 1000000000000000000),
            (".balances<a:403da6afca83e1d7b851cd40ece7716fbb7b6732>", BInteger 1000000000000000000),
            (".balances<a:41434c6b8f71f5f881307f492f4f727448003ecc>", BInteger 4000000000000000000),
            (".balances<a:41c4cf56480e4683b6b9c0d48444cff4db1cec66>", BInteger 1000000000000000000),
            (".balances<a:41f12e4742456501e189085a209c46fec1a3a4e1>", BInteger 1000000000000000000),
            (".balances<a:41f40d08a9dc05dea371c510718c363ee5eaaab0>", BInteger 10000000000000000),
            (".balances<a:43214b9c09f631d80dcc9d613cc17633ecda15ef>", BInteger 1000000000000000000),
            (".balances<a:434998ca1380d82437320a71c236cf986bfd41da>", BInteger 3200000000000000000),
            (".balances<a:43776ef7b7490c7862e0f32764f437159f4f31b8>", BInteger 500000000000000000),
            (".balances<a:44124735d0c83ac6bfd3aba030b5f187519c6c9a>", BInteger 2000000000000000000),
            (".balances<a:45546d423a9688c428ced63d9ca1ed8c6a2f0550>", BInteger 2000000000000000000),
            (".balances<a:45b8ea41b4258e082efaebf893b99e3d3a15f881>", BInteger 2200000000000000000),
            (".balances<a:4621e61b3673367ac0a63cbb97f2b75b9e9adffa>", BInteger 1000000000000000000),
            (".balances<a:46ba461fc6e5ce8b840abfe5fb2c05b626290d03>", BInteger 670000000000000000),
            (".balances<a:47d1d6e4a89f7094b8f9852c6087fd65888c5ac8>", BInteger 1682320100000000000),
            (".balances<a:47e1e94bdb7b39281137fc7318c671ad9f471ffb>", BInteger 1000000000000000000),
            (".balances<a:47facbf6bd58212d242c14bedf4864d0004561be>", BInteger 5000000000000000000),
            (".balances<a:489672ca49a9f0d4501d5a0998a158f568914bed>", BInteger 5000000000000000000),
            (".balances<a:48c9db3f87987231bad63bc7a4136fd2ddee726e>", BInteger 1000000000000000000),
            (".balances<a:48e4c2c5d1f9c5f91d86542253b07fc9bd36b551>", BInteger 1000000000000000000),
            (".balances<a:49afd231ccded2af05b196dd64be96c0aeb21c41>", BInteger 2000000000000000000),
            (".balances<a:4a24e02472c36122844c2641c3943bfd5accc06b>", BInteger 5000000000000000000),
            (".balances<a:4b0cc9c76b11b3444410d3961b372642584a52d3>", BInteger 5000000000000000000),
            (".balances<a:4b12a23819606de384fbdcd77c0c63f993d156b9>", BInteger 710000000000000000),
            (".balances<a:4b38f96c4cf6a80fa2ec3cad72784ad66b5df93d>", BInteger 1000000000000000000),
            (".balances<a:4b5b6bd3c3ecb29fb87ea30682de62a93a2ee450>", BInteger 500000000000000000),
            (".balances<a:4b863f8936ab6898d5b303d62d8aeb1c5959abc4>", BInteger 270000000000000000000),
            (".balances<a:4be097e03065c7a1ebf38e327cb7a8a2f6fee55a>", BInteger 4000000000000000000),
            (".balances<a:4bf4b8187495bee0406117b2868a6c7bb4dbdea4>", BInteger 12790000000000000000),
            (".balances<a:4c0f8316ff6a54a0afc65629fa22a02f7d22c399>", BInteger 1000000000000000000),
            (".balances<a:4c7829ff24a5d7bc6c4e4ade7685bdd4a6c9e2b0>", BInteger 1400000000000000000),
            (".balances<a:4d15e3824c3f2530f95fb6ca2bf75daa377ad604>", BInteger 288000000000000000000),
            (".balances<a:4d43b2c2a1a3454503c4abcc0b9ff09be96600d5>", BInteger 1000000000000000000),
            (".balances<a:4d95f3a5ed5cfaace3d82976f3a056dd26884643>", BInteger 9900000000000000000),
            (".balances<a:4d9cfd44ea75acef86ef504afa62762a79e133f8>", BInteger 6000000000000000000),
            (".balances<a:4de500214e6bb2538e1298602a62c45a59a58648>", BInteger 200000000000000000),
            (".balances<a:4e4d34521f5700af3b1d162c13dd3486c6d3b4d0>", BInteger 4000000000000000000),
            (".balances<a:4e5db6b7c05682f8a9369b5efe650fc0f3462f01>", BInteger 1000000000000000000),
            (".balances<a:4eb58b0d07200695c7976349bda43fa623c3601d>", BInteger 1000000000000000000),
            (".balances<a:4fd5fffd7339f87cfda1a62e0dd1adc6390951fe>", BInteger 2780000000000000000),
            (".balances<a:4ffdce7c49d405a77660c9f9160387d6d9b2e7bc>", BInteger 500000000000000000),
            (".balances<a:505abce9a22aaf3b169a7e123cf375ace5025647>", BInteger 1000000000000000000),
            (".balances<a:5061ab5d3656cfc655a70073480c15681f82ebac>", BInteger 1000000000000000000),
            (".balances<a:50d2d4e16522cd0c3ab34ac2d5b7fb2c773477a0>", BInteger 1000000000000000000),
            (".balances<a:50d5e5539e8ea84e4876130e99f6cb7f02cecdae>", BInteger 1200000000000000000),
            (".balances<a:514dc16cb66ace7c9044e2f93b9ac0ffebae7a86>", BInteger 1000000000000000000),
            (".balances<a:523b8d040b1eee19f4d75c65b39f760b34eaff81>", BInteger 2000000000000000000),
            (".balances<a:5465e679b7cd65efe63f7bbfe71334448f985e9d>", BInteger 1000000000000000000),
            (".balances<a:5481967719c1a0cc5f30e66e0256690baee5fec6>", BInteger 500000000000000000),
            (".balances<a:55d9e1551f52dcc3d3c233e002a0a4421fb81ff8>", BInteger 10499550000000000000000),
            (".balances<a:5678e8d6c7962c17cdac6dc7fccc4aad0bc027af>", BInteger 4999980100000000507904),
            (".balances<a:569c3da1497e6bd3f48dbaf662887dd61fc35975>", BInteger 1200000000000000000),
            (".balances<a:56bb6a6de0ebb6f4e8d6a19d9e2dcd56560f6002>", BInteger 1000000000000000000),
            (".balances<a:5725bc247c9301fac3195af126142b7f52b8f640>", BInteger 1000000000000000000),
            (".balances<a:57a0e7804bc91fc31cb0a6ea1ab3641c8e3720a4>", BInteger 1000000000000000000),
            (".balances<a:585b46b06b12bf27575cdb76dee6e718e8ceee91>", BInteger 45000000000000000000),
            (".balances<a:5911f06659861113e826e873f1d3e056eb6d0757>", BInteger 12673999999959420928),
            (".balances<a:59dddc5f6ad65f79f44a74b0355b0307853a0433>", BInteger 4643932959976556040),
            (".balances<a:5a9e763aa9c0017341a51cfae43bc76c834b6be1>", BInteger 2000000000000000000),
            (".balances<a:5b5485d90bca7b9a45436a3698360eff49e59596>", BInteger 1000000000000000000),
            (".balances<a:5c3b257309353575c6b3f57326cccf9b6f6a3426>", BInteger 2200000000000000000),
            (".balances<a:5c3f3efd9e4503c281a862d86bb0cd7fcbbd421d>", BInteger 1000000000000000000),
            (".balances<a:5cc1db3898e2551918c1d4b49140f9516bc91116>", BInteger 1000000000000000000),
            (".balances<a:5ce2717fab20d91370f2877c3ae6ef0fa29dd30f>", BInteger 3000000000000000000),
            (".balances<a:5d118fdd6f875f2334457fa975b01a3365be90dd>", BInteger 5000000000000000000),
            (".balances<a:5dec8597d4ecbe62ed6743d61aa41907e7b4ee8e>", BInteger 1000000000000000000),
            (".balances<a:5e3cda4b4597f456b7ecde8ea2f6d65c79b2830f>", BInteger 7987609627272727040),
            (".balances<a:5f821f86121072e012b047d7b6fe80b6f663a4e4>", BInteger 1000000000000000000),
            (".balances<a:61d430d2c15ac18a180f897ffb098d362c371635>", BInteger 2000000000000000000),
            (".balances<a:62cea41856a3176a2c980a48f6278b6982b2cc21>", BInteger 10000000000000000000),
            (".balances<a:63944288810a27209cfca8fb9b2b437d70ac26ab>", BInteger 1000000000000000000),
            (".balances<a:656a02c3193f43d4bf45f2329a2767a58d82767d>", BInteger 500000000000000000),
            (".balances<a:65b09013d258bc610bc15f47c9a870eca9299c40>", BInteger 990000000000000000),
            (".balances<a:6640b64843481443f3a5f5fef7f2b1fc897fb14c>", BInteger 1740000000000000000),
            (".balances<a:673babfc3b420cbfc43366ee88efe7516e6e8fd7>", BInteger 5000000000000000000),
            (".balances<a:67401434f1fcb3c4285e35a6ca78dcfaaf59515c>", BInteger 3000000000000000000),
            (".balances<a:67b1f9961dd295e07ec7c11b074eb25b75e19bde>", BInteger 14766586899999999655936),
            (".balances<a:67c0261306ad995ab936da34750116455d6b0623>", BInteger 1000000000000000000),
            (".balances<a:67c97da74a1d12753a7867259c820f45c7452723>", BInteger 500000000000000000),
            (".balances<a:67e1429b0ada312efcd40c7063a286ba1fab7cba>", BInteger 2004000000000000000),
            (".balances<a:680d8056cb485bf42ba7c6da53ac2af51e55b291>", BInteger 1000000000000000000),
            (".balances<a:68bf6b5dca01191efde96bbea00854b3fe879c35>", BInteger 1000000000000000000000),
            (".balances<a:68caa26b2ad39535592f33a6cdd5f30494e58f54>", BInteger 5000000000000000000),
            (".balances<a:69387f86544f0a8d6c1edac80f6d508014e945bf>", BInteger 200000000000000000),
            (".balances<a:69a0bae2777c7acab23dce88ff6a4f6ee313f925>", BInteger 10006285000000000000),
            (".balances<a:6a2979d709eef08564d3d715e82bbb2a2b2f62c6>", BInteger 270850000000000000000),
            (".balances<a:6a4ad50fc3b3bb12e8c246dd13649bbcbf0c011c>", BInteger 1000000000000000000),
            (".balances<a:6a85da2ae9f4a33839df3bea17ecf2e40e3a2bb5>", BInteger 59880000000000000000),
            (".balances<a:6b10fee364fb4053a5ce58e47f6081f1ca3eb191>", BInteger 1000000000000000000),
            (".balances<a:6b30384be5e4cdf0603722e8a6405ddc4b772b2b>", BInteger 904000000000000000),
            (".balances<a:6b7bcd55039dfebfba79db942be4f5d04f601730>", BInteger 500000000000000000),
            (".balances<a:6bfcf4d95f51e0e130ff58f563686665b8c5b8ab>", BInteger 1000000000000000000),
            (".balances<a:6cf8060e0e3c71687cf5b422f321c0cc30f4018b>", BInteger 1000000000000000000),
            (".balances<a:6d838d14a9cd9cdac4d4fc31fbd8387a98501a81>", BInteger 100000000000000000),
            (".balances<a:6e3c518a7703dddeb80f49dab2d8cbe08987b579>", BInteger 4500000000000000000),
            (".balances<a:6e8a767a98be878392092972a8b83bb9049f334f>", BInteger 4800000000000000000),
            (".balances<a:6eb32a918ebbacfff8cb73eb5df69821750f50d8>", BInteger 1000000000000000000),
            (".balances<a:6ec8bbe4a5b87be18d443408df43a45e5972fa1b>", BInteger 1497423659613902955322919),
            (".balances<a:6f7761e49872425789c01f917e5fbd94a179808e>", BInteger 3000000000000000000),
            (".balances<a:70746d875417fe820856edbb1f8b58f4c231359c>", BInteger 2000000000000000000),
            (".balances<a:70fcd7da08011ebeffd443850fb5ccd008a331d6>", BInteger 1000000000000000000),
            (".balances<a:716f6b1d95d6d34b041f60ad450a46b0f2f6db22>", BInteger 1000000000000000000),
            (".balances<a:72328a3d0f1fc31ac45e854cfc42558fb7cb5466>", BInteger 1000000000000000000000),
            (".balances<a:7287a3654fb0b4fde9e94283e98c8dcb6112a854>", BInteger 2000000000000000000),
            (".balances<a:73007d81deec94c1aa0158036b6ac092591d0e32>", BInteger 500000000000000000),
            (".balances<a:73010a568680e55e73ec32017d466d3bf837df65>", BInteger 369900000000000000000),
            (".balances<a:734a3c5b2db23ac80b2d21aa6dd7b76e1f8fad40>", BInteger 5500000000000000000),
            (".balances<a:740faf6a6fe1f53fd70015aa605107b9049f1e8b>", BInteger 1000000000000000000),
            (".balances<a:741f03e0259eb0f48de81803802188c54d9c8dcb>", BInteger 2800000000000000000),
            (".balances<a:743e98d4d382a2bebf754866d143e635f6f41387>", BInteger 1000000000000000000),
            (".balances<a:74ca0a355c2012bff65cd68a0d2ce446e5b55e1f>", BInteger 299876000000000000),
            (".balances<a:74ca62bdbe07f3b470057d5dfda9d1c901309368>", BInteger 1000000000000000000),
            (".balances<a:75d860dcff0a40c9ee977dfc243f57ac5189bd33>", BInteger 500000000000000000),
            (".balances<a:76a5356b8a460846f2e10fa2fc7a053fb117b47a>", BInteger 1000000000000000000),
            (".balances<a:76bbd9fc66feab549491198d0f5576b3d778800e>", BInteger 500000000000000000),
            (".balances<a:76d8679c1eda307672126c80f94957c7be8dce6b>", BInteger 1000000000000000000),
            (".balances<a:773713f2bb604c9bc9c2011a46c7c4d5e68914b0>", BInteger 2200000000000000000),
            (".balances<a:778491251f596e8a26b4f215689e16a668607ea9>", BInteger 1000000000000000000),
            (".balances<a:779dfe0d1a88bcc802a534795e4dbae686a7333e>", BInteger 500000000000000000),
            (".balances<a:7831e4fbb2564733898cdd94debd501357a9986d>", BInteger 125074000000000000),
            (".balances<a:7923279dfe84d38bdb67a4aab66ebc39224d08b3>", BInteger 2200000000000000000),
            (".balances<a:792c3c12edf493517b1b375d4dc80b441a4c1d1b>", BInteger 1000000000000000000),
            (".balances<a:798ad0a9c8919e213f9a0aa1d5b28a2d24916ed4>", BInteger 9999990000000000000000),
            (".balances<a:7a2dcdf3f7d8f7086fb86cb2b0f77df30a6afc8b>", BInteger 4000000000000000000),
            (".balances<a:7a45b398bf03594e8756b6d96653358568b82312>", BInteger 1000000000000000000),
            (".balances<a:7b4764a584e54599194204deabaedb7f6acf3ecb>", BInteger 2500000000000000000),
            (".balances<a:7b9bafbc297d7c4c78ec10c980378613778903f9>", BInteger 3000000000000000000),
            (".balances<a:7ba8b3ee943b2274fad7ea783f0e91da80e23a88>", BInteger 500000000000000000),
            (".balances<a:7cc515bad7c8e22f0fcfc50a22d359accb525753>", BInteger 1000000000000000000),
            (".balances<a:7d54067c14c7a1efc4665776f7c21b987d44ba71>", BInteger 1000000000000000000),
            (".balances<a:7de9e4e4b66805021b1e48d7e93f878bb21838b3>", BInteger 1000000000000000000),
            (".balances<a:7e38536f310ad7478c546a59d4f7185efdeceba4>", BInteger 2000000000000000000),
            (".balances<a:7e42dd8a1010ae68db1cfedc878950e15727d05b>", BInteger 1000000000000000000),
            (".balances<a:7f325e966cca5dd9e0e09ee633a7d2f64876e2b0>", BInteger 272403581736778720),
            (".balances<a:7f43d16cdc7a486c9ec2a7ec2439db3effcba1a6>", BInteger 5000000000000000000),
            (".balances<a:7f55e704946ede41faa8c2282be41b0c3277f68a>", BInteger 2200000000000000000),
            (".balances<a:7fa5f4cbcccb4a21c2bb34dd3ee2c7ed41a370d2>", BInteger 2000000000000000000),
            (".balances<a:80c4f8a2bd613507d537c02506ef3c6ec70928aa>", BInteger 1000000000000000000),
            (".balances<a:8123ad68f30351433b5f6fcc3824f4a10d726c00>", BInteger 500000000000000000),
            (".balances<a:81e140a8f3c3e5197523907902ee402d4040c649>", BInteger 2000000000000000000),
            (".balances<a:823f90c4ede726bdf2fb59e0e706fbdbb6f5e783>", BInteger 900000000000000000),
            (".balances<a:824bb3381aaff9d21b31ef5049e1a718379050ef>", BInteger 5000000000000000000),
            (".balances<a:838ca66f9593a855cdd6a7f00b2a4c812c8a9ac8>", BInteger 14629000000000000786432),
            (".balances<a:851c5182d541115c0c0ebf377ad98f95e36510d2>", BInteger 1200000000000000000),
            (".balances<a:855506b45f5e5181f2b570a6be2af766f5d885f3>", BInteger 5520000000000000000),
            (".balances<a:857520d8413f3c1bade69e80a672f01903071650>", BInteger 2000000000000000000),
            (".balances<a:857d8b8f4db6409e79a4ecaf2c507e7c0c1e732c>", BInteger 1000000000000000000),
            (".balances<a:862473e1aec4636f20964e78cafd3936efabeeb7>", BInteger 1000000000000000000),
            (".balances<a:86308ee8ed1b0505959b911966751f9e61f5693c>", BInteger 1000000000000000000),
            (".balances<a:86602eaf87d7fe94f40b512bc7314700a1b9e1bf>", BInteger 100000000000000),
            (".balances<a:86e928e301f7a0bd296b7dd72bc5d1b3309fb7ed>", BInteger 15800000000000000000),
            (".balances<a:8705dcb6e1595443636584b0fa2052a9275fa51f>", BInteger 2120000000000000000),
            (".balances<a:87483561f4acf1e56276d1c314328c624a5754b1>", BInteger 5000000000000000000),
            (".balances<a:877903695e9914afc56ca8cad93b544db0d75b4b>", BInteger 699930000000000000000),
            (".balances<a:87824d8d511a24a8b31f9892650755a90fec959a>", BInteger 100000),
            (".balances<a:87841747ec086a3649cde22d6856d3cc53893f71>", BInteger 2000000000000000000),
            (".balances<a:87a0a629b10989ce098494f7117ff4c0036ed067>", BInteger 2000000000000000000),
            (".balances<a:87e01d6f998980434bf8a8d882bd93de751d8157>", BInteger 26804000000000000000),
            (".balances<a:88ebf7723a11aa566c3545ada4f85262a5b9624e>", BInteger 500000000000000000),
            (".balances<a:89002eadaf5506ebd995ae1ee802f97a9b02afeb>", BInteger 1000000000000000000),
            (".balances<a:89ef8e1c21201a49ad7b477685588f00cb15ab67>", BInteger 1000000000000000000),
            (".balances<a:89fd2b433dafaf08e6ee1652bd4fedb8207050b7>", BInteger 1000000000000000000),
            (".balances<a:8a8382d00dced03b4f9077da6822ed351991a8cc>", BInteger 2000000000000000000),
            (".balances<a:8ad0b29413b9617d02256bb171291af4b36daf8a>", BInteger 5000000000000000000),
            (".balances<a:8ad65530f0d5ab4f810a3a399e6e9638bd807a06>", BInteger 1000000000000000000),
            (".balances<a:8b74ec0787e2fe6dca5ce2a3a481274720a05733>", BInteger 1073974109402380264),
            (".balances<a:8e037a1cf449f1716f5503382a606ee69dce62c4>", BInteger 500000000000000000),
            (".balances<a:8fea06e75c1ad08fcac53cdb3e52c8861b8e5a50>", BInteger 5000000000000000000),
            (".balances<a:908aa8740d54234702ca24e918da4cd661dbeeec>", BInteger 1000000000000000000),
            (".balances<a:90b2570080b214fda268f9a2e3b0d1b6e6b53ab5>", BInteger 50236397000000004096),
            (".balances<a:90d7af2bfb68584b1018620aed1b271ccc0ba45b>", BInteger 1000000000000000000),
            (".balances<a:911dba2cb8102d008a84b1ffb9da5cb9b486796f>", BInteger 9073876491956412544),
            (".balances<a:9125de909dd08d833fb54414f37ea515360f8577>", BInteger 1000000000000000000),
            (".balances<a:919525d550d873f40607f58718faa967724313fd>", BInteger 499960000000000000000),
            (".balances<a:91aef73aab9ee204a3cd54e25f760e301f6c3053>", BInteger 5000000000000000000),
            (".balances<a:9427520f823dbf8bf078d51c6d43bdf4d3d7f781>", BInteger 1200000000000000000),
            (".balances<a:94317311e576f8491312432d87141e0a98395cf6>", BInteger 7000000000000000000),
            (".balances<a:94534bb9baae3836343d45e97016744149fc82ee>", BInteger 1400000000000000000),
            (".balances<a:94c836a44413089d37118cae8caa70317d8dfa86>", BInteger 1000000000000000000),
            (".balances<a:94f163a855122a304a71564ddc660af46b2344bd>", BInteger 5000000000000000000),
            (".balances<a:957908ed1306c18bf952d9f5072a3e9daead2b9b>", BInteger 2650000000000000000),
            (".balances<a:95e003754fc6e152a5930d40b31ffc54b17c76f0>", BInteger 60000000000000000),
            (".balances<a:9612073a801f1ce268a65de3d48de42ba98ab1a5>", BInteger 3000000000000000000),
            (".balances<a:9685131a7e824c472fc49413c97ed69b83769c7f>", BInteger 1000000000000000000),
            (".balances<a:97944fb0169719b714a83905a31bc475ccb4d966>", BInteger 1000000000000000000),
            (".balances<a:97ab088d7c786086dcb7a3e81c393228fa5ec3e7>", BInteger 3000000000000000000),
            (".balances<a:97f4ba07dc35e630a9f62abdedd15ae4503700ea>", BInteger 1904000000000000000),
            (".balances<a:982583165e8c21e8f2f50d2ed5ae9ff28b8785c9>", BInteger 1000000000000000000),
            (".balances<a:98f69ea61188740d2ad00a134ce4db5c3bb720a1>", BInteger 10500000000000000000),
            (".balances<a:99598ef01d824e08395438016e6d9805f5d81b40>", BInteger 1000000000000000000),
            (".balances<a:9990e172586ea0d7e59e34d815bcbd4196702a43>", BInteger 2000000000000000000),
            (".balances<a:9a7703215f541ce5c5e7b7cf4aa9103044ee45ba>", BInteger 200000000000000000),
            (".balances<a:9ba24a2ad48977d7bdcdd060d93bdaa238974a1b>", BInteger 1196300000000000000),
            (".balances<a:9ba3265d5b3f2d4adbd5f373bf9624488f02f859>", BInteger 5000000000000000000),
            (".balances<a:9c5755194e1576bdda752aad63e2ca4a5b04f731>", BInteger 1000000000000000000),
            (".balances<a:9c8d4d550d8119470d1e530eb39a91ce145bea67>", BInteger 2000000000000000000),
            (".balances<a:9d311d76fca77880116bc6d95dce0eef6974ee51>", BInteger 1000000000000000000),
            (".balances<a:9d37c538ba44e606871b2e74f99784e619a5836e>", BInteger 1000000000000000000),
            (".balances<a:9de762cde7b7cabad9e5e1f5dcf24361da7d394c>", BInteger 1040000000000000000),
            (".balances<a:9f16f6f66d955048e8c5bbc59f06b1480be3e291>", BInteger 2500000000000000000),
            (".balances<a:a0064c0b6a127d2b5689a764449fd37816e66941>", BInteger 1000000000000000000),
            (".balances<a:a0871c26a061f43a11b1ffe8216b178e0097ee7a>", BInteger 4200000000000000000),
            (".balances<a:a09726e6f92b9181207bf3b4b397b1ea05f10a16>", BInteger 4000000000000000000),
            (".balances<a:a0ad0dc4c754d507ca7964246fa9590d6a3df8d4>", BInteger 348660000000000000000),
            (".balances<a:a1034b3d784929154d3110073835a97ea1402344>", BInteger 500000000000000000),
            (".balances<a:a1ae6ab393c5571f3a6b5386580c386cf9488519>", BInteger 34108220000000000000),
            (".balances<a:a223babcd2b5912c1f66b16ed6b79f7d18a4e41a>", BInteger 1000000000000000000),
            (".balances<a:a264d47435bf60967133eff3f1ea6fbb10e08c38>", BInteger 1000000000000000000),
            (".balances<a:a269de99fa92471a237b4ce9fdc567e414ca0c7b>", BInteger 1000000000000000000),
            (".balances<a:a27dcdd5b6703a22a5e8f5de0413245a98f9540a>", BInteger 1000000000000000000),
            (".balances<a:a2d82a501419f0507db842ef1fee28f2c9f5edbe>", BInteger 1000000000000000000),
            (".balances<a:a32fd9b767d8b8875970f1b27e1b9e12696bdff1>", BInteger 85570500000000000000),
            (".balances<a:a46c325006b9dbb83d33041fed4236ddfede1ed8>", BInteger 849930000000000000000),
            (".balances<a:a4706a06ceade15e22b66ad4317d2720e7c8aecd>", BInteger 500000000000000000),
            (".balances<a:a4f183efdc419cd4606b35aae75e96ff14da7aea>", BInteger 1000000000000000000),
            (".balances<a:a5d49ab64c2e3eb6637c46536feed3f23ba93378>", BInteger 2400000000000000000),
            (".balances<a:a5e65d33bfdb81f5fbff98647a6c260fe9982af9>", BInteger 1000000000000000000),
            (".balances<a:a61034d190d78ac89fca9ca87d2afa16213e9039>", BInteger 5000000000000000000),
            (".balances<a:a6a3a91d8e5519dcb2732ac3e1631ab30ab995e9>", BInteger 5000000000000000000),
            (".balances<a:a74224f55fcf9d045edcbf738ebfcf62f40515cb>", BInteger 85429900000000000000),
            (".balances<a:a77aeb168753f09b7b40d68d744da541d59b2e22>", BInteger 1000000000000000000),
            (".balances<a:a7f462b95e0f3a3036d2ebb501a02f67a2a49d7e>", BInteger 1000000000000000000),
            (".balances<a:a8c590637b8994a7b52b965719a986278d705571>", BInteger 200000000000000000),
            (".balances<a:a90e74dd9c7449de3af84a959d978c799c6d00f7>", BInteger 1000000000000000000),
            (".balances<a:a9fa3a041f2192c6378b874bd56593ae8549d0e8>", BInteger 1200000000000000000),
            (".balances<a:aa72aa26b9f88b97202f0f1019a21b2acddf21cd>", BInteger 6000000000000000000),
            (".balances<a:aa7d165466ad31a98d7502cc91b7cd24334ec8a0>", BInteger 1000000000000000000),
            (".balances<a:aa8dbdf2500773faf37a6258002412a8dff01194>", BInteger 2200000000000000000),
            (".balances<a:aaf025df140605f52ec1135b93d4b202632ef98a>", BInteger 5000000000000000000),
            (".balances<a:ab338787f12428b9dd09705e9f7131c57086c00c>", BInteger 1000000000000000000),
            (".balances<a:ab73abce85546c44e3f8caa0f515ab8b83d0d545>", BInteger 1000000000000000000),
            (".balances<a:aba1e58958107c4267c090786972e64b970ec19d>", BInteger 6968920000000000000000),
            (".balances<a:abf177d6d30274c3abd53f26a03f1123822c1bcd>", BInteger 2000000000000000000),
            (".balances<a:abf2def6ab2569b247204b6df6b3cd3d5cfd93e4>", BInteger 10000000000000000000),
            (".balances<a:abf5eb6df2eedd2ae766cc78768f996f58e6b960>", BInteger 300000000000000000),
            (".balances<a:ac8de9e7088e08c0a8facc90e06d7317af8f820b>", BInteger 11099400000000000000),
            (".balances<a:acb6e71a50804c25d8e8ed2842bb4fafecef94b2>", BInteger 90000000000000000000),
            (".balances<a:acbd432eae7ce75fea10251c24f55d691f1d83da>", BInteger 130000000000000000),
            (".balances<a:ad1e0302eb23e0dc2f93d544ea4949c83f4cc1b2>", BInteger 2200000000000000000),
            (".balances<a:ad1f5881d45733e5888a525a978d7e9ebce6c750>", BInteger 500000000000000000),
            (".balances<a:ad631cadebab4124fa50eb68dea2f96266a25a5b>", BInteger 500000000000000000),
            (".balances<a:ad899d32c5589d73e6ccdaf9932d82b1314f8e73>", BInteger 6000000000000000000),
            (".balances<a:ae45c7f695d36d1e08c701446f758276f59f87e4>", BInteger 1000000000000000000),
            (".balances<a:aeb625a1db17be6202bbeba2b5851744bc5e1b11>", BInteger 500000000000000000),
            (".balances<a:af1a28d7223c22d621dd29e9d5cf4e44f7482250>", BInteger 6200000000000000000),
            (".balances<a:af958d7ef7405e809cff93bfb7b0cb31ee655d70>", BInteger 2584500000000136),
            (".balances<a:b015d5504c4dd98ccd8c12639195848aee8c4f47>", BInteger 10000000000000000000),
            (".balances<a:b03554a5f58734e8d6fb6e188e5bc8dd25db9351>", BInteger 1000000000000000000000),
            (".balances<a:b113efc2a2948ce8cdc9887bb605e23fd048f118>", BInteger 5000000000000000000),
            (".balances<a:b1518476a958cf892630ab9885fde5c20cc51413>", BInteger 1000000000000000000),
            (".balances<a:b158b2107035623f5c681706759df7120158e139>", BInteger 100000000000000000),
            (".balances<a:b15df7a79c596da59b1272c968e9923b9ad6f539>", BInteger 1000000000000000000),
            (".balances<a:b18595fb1c97266d1597217f3e3b6fdcc1c52b71>", BInteger 500000000000000000),
            (".balances<a:b1a0057e00a786a286169891fa732b6296900b0e>", BInteger 26200000000000000000),
            (".balances<a:b265c4f060e0b960238e1fde66542a3c081adb0a>", BInteger 5000000000000000000),
            (".balances<a:b29680969d1e978a56b6b028ad75636fe88a3775>", BInteger 1000000000000000000),
            (".balances<a:b2b02e1cbf7ece91f7505f66b9b4f907575131a0>", BInteger 22120000000000000000),
            (".balances<a:b2f744ca5e5c30ddc74f3b8da1e1a26970461d99>", BInteger 500000000000000000),
            (".balances<a:b3073cad413ae36d7c5bf82414c4b55433492ec3>", BInteger 31200000000000000),
            (".balances<a:b373b00913501a0b8560344bfdf5d2d970d9bca2>", BInteger 173739068263218976),
            (".balances<a:b3b14ed88af7e5f3ce219fb764952bcfefbf7501>", BInteger 3750000000000000000),
            (".balances<a:b4365351dd8d006667d4af0443e4d00ebd1205ef>", BInteger 1000000000000000000),
            (".balances<a:b4f8c7e2775531ae246164006192cc20cd4b60a2>", BInteger 2000000000000000000),
            (".balances<a:b5001d9c1c6526fbfadde85599ca3911eae462b7>", BInteger 1000000000000000000),
            (".balances<a:b66b3e8cdc2ed71b7feefb9a0ea03889b324fa99>", BInteger 450000000000000000000),
            (".balances<a:b6acc53842bffd084810599b2506ffc9b8d114fc>", BInteger 1000000000000000000),
            (".balances<a:b6c6b1893d60bfbbed56d50f17bef9f38495ddc6>", BInteger 1000000000000000000),
            (".balances<a:b6f283a3801fe1606810ea74915dddb4f69bbc65>", BInteger 1000000000000000000),
            (".balances<a:b8118132385f65550ec3320a95eac49deded7d10>", BInteger 500000000000000000),
            (".balances<a:b8ccbf0d76c4b6668513f44b13185d7ff68702c8>", BInteger 500000000000000000),
            (".balances<a:b8ed55f596f11875d6734983e2d11d5cbfcc2ada>", BInteger 500000000000000000),
            (".balances<a:b960877acde4dc0078082e51b77c4780ebc490b0>", BInteger 1000000000000000000),
            (".balances<a:b9bff61f257dce84483c5bf51ecd67294429afde>", BInteger 1000000000000000000),
            (".balances<a:bb58782eec98ee2bc310ba9902c3b8c17a0b1006>", BInteger 500000000000000000),
            (".balances<a:bb58a1ad2c3cc9d2e684769b08ba6bc5cd40bd45>", BInteger 1000000000000000000),
            (".balances<a:bbc802b73b3830f91bc637df8355ca1fc1799c78>", BInteger 218520000000000000000),
            (".balances<a:bc054815ba4c30665fc1464d659a565db350fe91>", BInteger 9647000000000000000),
            (".balances<a:bc8774a182759d9af95aee4a72e9327ddd051eba>", BInteger 8000000000000000000),
            (".balances<a:bcc87ca857e8613bcb19cfb4173b20cdded27e78>", BInteger 500000000000000000),
            (".balances<a:bcdbaff79c056c1a3c1db0d2f1a9e55921515889>", BInteger 1000000000000000000),
            (".balances<a:bdd88fcbcc69b3a4bbe34eca24123caee3fa1cc7>", BInteger 4500000000000000000),
            (".balances<a:be85ddf7237b62e587a2653829893b0c13ec0c09>", BInteger 800000000000000000),
            (".balances<a:bf53370b7b4bc3f616a655575b9a0d9938192683>", BInteger 604800000000000000000),
            (".balances<a:bfe7966421a5a6cb6e4223a571a065ed535f875c>", BInteger 27150000000000000000),
            (".balances<a:c07f72d1e58e6fab45e9ef4d4df0a10fe96f78b6>", BInteger 1200000000000000000),
            (".balances<a:c0a078d856a70578c0996d62b094d18b8b6b546a>", BInteger 5000000000000000000),
            (".balances<a:c17584094a776a6a948b35986377cddea90361b7>", BInteger 500000000000000000),
            (".balances<a:c1bbfcc369c3a1306783b3ff328b734ee4abde68>", BInteger 640000000000000000),
            (".balances<a:c1e8e57d94617fe08820e8f89ac48920cb3e03dd>", BInteger 21720000000000000000),
            (".balances<a:c24e72ff7e916eb8b556bd977df8d81cce31aba7>", BInteger 1000000000000000000),
            (".balances<a:c261380e03e69fe0315fac7fe55801838cbf9fd7>", BInteger 3000000000000000000),
            (".balances<a:c2a62ad5227b631ca96a24d0e04e5a53c18353be>", BInteger 1000000000000000000),
            (".balances<a:c2b5b269aaa46a75945a12b52ae40d313f415570>", BInteger 1000000000000000000),
            (".balances<a:c37186cd9455e601f76a8ca95b241251040d9eef>", BInteger 1000000000000000000),
            (".balances<a:c389b9bf00c48ad3a5b6a5719f1fe4ba6f62391d>", BInteger 7000000000000000000),
            (".balances<a:c3cf91c727b463a4975e7e3581c2abce2bf74546>", BInteger 2000000000000000000),
            (".balances<a:c3ec562a1b0ad2e0456bcd66412e91751654482f>", BInteger 157218148437646485893784),
            (".balances<a:c4384fad71e4e51c2248d619784ea3347212d882>", BInteger 1000000000000000000),
            (".balances<a:c43affa38679ecc9119c03d2fa75309aaa2992f7>", BInteger 1800000000000000000),
            (".balances<a:c4b9c2ddec6e31c0fd0693d5ee7b87e357f3276b>", BInteger 2000000000000000),
            (".balances<a:c578049f6e13dec6dd658ff996562b0e501876a8>", BInteger 1000000000000000000000),
            (".balances<a:c628e023ffc314e9f2c44038b128ee1e7cda1147>", BInteger 1040000000000000000),
            (".balances<a:c6573398e9adec828a80856cc4d36ab3bb885ac0>", BInteger 1670000000000000000),
            (".balances<a:c7047324847e354af802e11e85eefe8e86d2c674>", BInteger 1508670000000000065536),
            (".balances<a:c732cd3784fe45f4e96c2cfcb886db4e0de68ada>", BInteger 316000000000000000000),
            (".balances<a:c79c44146581b2a08ba6bb0c72fcd2f8258d7855>", BInteger 1000000000000000000),
            (".balances<a:c7d15057baab722239d75ec55ec53856b21c68d8>", BInteger 5202295762168381986),
            (".balances<a:c7d691fb2fbb34f3e0c1a65496bb00a6fe29b6cf>", BInteger 500000000000000000),
            (".balances<a:c84a02b2d89dd43097d6e9a24ac6596f002534cb>", BInteger 10500000000000000000),
            (".balances<a:c8c8f99fd295b283b6f01c31241e5da30e66320e>", BInteger 10500000000000000000),
            (".balances<a:c9991ce69c5f0f0f0e01f114617f4d5a35f8ad4c>", BInteger 2000000000000000000),
            (".balances<a:c9e43928d5fed70d67d17b1cf1c722825ddfe729>", BInteger 5000000000000000000),
            (".balances<a:c9f663ec83aff247b21bf9f98c62a4f8309d0c02>", BInteger 1000000000000000000),
            (".balances<a:ca64728e311030da7b8c4c3b3856c3ea168a4e87>", BInteger 799558000000000065536),
            (".balances<a:ca9a40802f6915eeb9683db9bd3d075e44fa2678>", BInteger 1000000000000000000),
            (".balances<a:ca9c97b808e13ec2315fe5bdb752a3cac0939845>", BInteger 500000000000000000),
            (".balances<a:cad560766de3eb36e39ab0d5f935e0d433d8bd70>", BInteger 1000000000000000000),
            (".balances<a:cafe17f59107ad99bd46a1561cc78a8d4d944969>", BInteger 500000000000000000),
            (".balances<a:cb4c3f3f68b6bc698f9a82642b1b15e163deb0fe>", BInteger 1000000000000000000),
            (".balances<a:cb85e12ca5d98de95715fc75ae251a66b662ea06>", BInteger 9733989079391441606352),
            (".balances<a:cba1e3ff2544d7716a3f4cd6fc0710a9330212ff>", BInteger 1000000000000000000),
            (".balances<a:cc92e0a131a05655d5b591688d203809a467a28f>", BInteger 100000000000000000),
            (".balances<a:cd10e573e414c9d7355151235a4aacba7e13800e>", BInteger 200000000000000000),
            (".balances<a:cd288340d06f0b9c2f4407994c3d5459165bdee6>", BInteger 10000000000000000000),
            (".balances<a:cf263b04e895c0570a1bf8d8304bc1a0832229f0>", BInteger 2200000000000000000),
            (".balances<a:cf8040683cf17f064f9c1828873cf118a09af4ed>", BInteger 1000000000000000000),
            (".balances<a:d033cd9f08b5690f7257fd4e3c97e4bf620937de>", BInteger 303300000000000000),
            (".balances<a:d0a1dd7bfff045ba9f7dbc965c4f53ce08dd7be3>", BInteger 500000000000000000),
            (".balances<a:d12cd12cea1cf43fb3b6e89b18563f17ce2d27b4>", BInteger 1000000000000000000),
            (".balances<a:d3196f77334556e245dd152b8ec2cff21a9ab18c>", BInteger 1000000000000000000),
            (".balances<a:d3320630e0e14eaa68b2e0928b381a79528e1750>", BInteger 380000000000000000),
            (".balances<a:d34cc51aa1546e78e2bbf708a7203ae5a42968f0>", BInteger 5000000000000000000),
            (".balances<a:d429a22c64389ad9512ba30be7b7e125ec6fd217>", BInteger 5000000000000000000),
            (".balances<a:d4ad379cf1be9d726feb22e48c0da4fbc76d1553>", BInteger 1000000000000000000),
            (".balances<a:d59161b188b1bc787d8af90e133c402089abc6d0>", BInteger 2200000000000000000),
            (".balances<a:d5fdf546b31fd0e2214e3b6dacd1740d3bb9914b>", BInteger 200000000000000000),
            (".balances<a:d67a63e1102d92f945a85987c3a9787c2e13a1db>", BInteger 1000000000000000000),
            (".balances<a:d9792bc94e06555bbd147849ff129ebed016d59d>", BInteger 500000000000000000),
            (".balances<a:da992913baec8ab2068e8be03340d5c3665ece1d>", BInteger 500000000000000000),
            (".balances<a:dac0ef9002f8ee6b7998bd85c0aa185a4db5d3a1>", BInteger 294170029531237796312),
            (".balances<a:dae59771ee663fa0aacf617e6efebbbc654f7a04>", BInteger 1000000000000000000),
            (".balances<a:db2a75429f0ba2fcd3fefe43f0236298718b0793>", BInteger 2000000000000000000),
            (".balances<a:db4b5c5a7b01dc85f0228b33d57c506909af4af8>", BInteger 16000000000000000000),
            (".balances<a:db6247ff507bed52537ec5019c242bf2bce82a67>", BInteger 10000000000000000000),
            (".balances<a:dc3493bf5d6ad4e7e0e6af95f1c3ef25ad228887>", BInteger 500000000000000000),
            (".balances<a:dc5f808d3a8ac121c7b7507c64e4d9386a4f254e>", BInteger 1000000000000000000),
            (".balances<a:dcaba8ce89cf9bd32646efe75d3ed4238c8f5994>", BInteger 1806000000000000000),
            (".balances<a:dcfc825b9510e19afdd330bcde0256866f792e05>", BInteger 1500000000000000000),
            (".balances<a:dd2fe97c30542faefce600ce718f74ae0380162e>", BInteger 1000000000000000000),
            (".balances<a:dd874a813f34d03ef3ce63fe42f0ffe149dda60d>", BInteger 1000000000000000000000),
            (".balances<a:ddfcec5a4c0a7a79656c039bfcd1298f8b91c06e>", BInteger 1000000000000000000),
            (".balances<a:de0f6f0ed026b04b06428a5a554d7bb501bc773f>", BInteger 1000000000000000000),
            (".balances<a:de3ffa97ddddca20b181a2c34470ee5e14352de2>", BInteger 5215614400000000262144),
            (".balances<a:ded692dadfffc1ad2593a26d2b4b71424c8455f9>", BInteger 449390000000000000),
            (".balances<a:e0946eca885a02d0f022962bbe8d19d1c317dc12>", BInteger 247100000000000000000),
            (".balances<a:e2a700e30e0d4a0320e8c8759dd7d09a99f40f5b>", BInteger 1000000000000000000),
            (".balances<a:e3272935912c77ce6342c0a052fa1ba112ad8ad7>", BInteger 5000000000000000000),
            (".balances<a:e386fbafca8453fec90d9b4f4a5dfa9f25b35979>", BInteger 130000000000000000),
            (".balances<a:e3e110c27bdbca3d322ad3632747c3440102910d>", BInteger 1000000000000000000),
            (".balances<a:e3eaa23290e29906001da2df0b874699d7a8d150>", BInteger 1200000000000000000),
            (".balances<a:e466364978d4cf823d2132cc6a549fcefb7214f3>", BInteger 500000000000000000),
            (".balances<a:e4bf5a0924907474d0aef42c25c8a031d1f48b1e>", BInteger 1000000000000000000),
            (".balances<a:e5aad6dc112f626373c524987dfa7d4fb8dfe5bb>", BInteger 2500000000000000000),
            (".balances<a:e5c0145be9d3738bcc5ae4e824662a6097720760>", BInteger 2690000000000000000),
            (".balances<a:e69b6cfa8de2cc6355fb20e4e12bb1e0b368b22b>", BInteger 178540000000000000000),
            (".balances<a:e6b1f502afddb7d38c8182a118ec7e8d60edefd5>", BInteger 206000000000000000),
            (".balances<a:e78dfbcb6b2ad6b7215b140b6bcce0a15299e77c>", BInteger 1000000000000000000),
            (".balances<a:e7b64fefee5943ef94bdda7c7f0f05d74abf1c2b>", BInteger 768400000000000000000),
            (".balances<a:e7f0f94d0c11a0c8deebfde6f50ba911f2ec5a4f>", BInteger 10000000000000000000),
            (".balances<a:e8910e811dc4ca7bcafa9ac7ce438a962db45bd7>", BInteger 2600000000000000000),
            (".balances<a:e9d28f70769cbe284bb0451bdd742d8881e9361c>", BInteger 10000000000000000000),
            (".balances<a:ebe9b31b623b80990105ec781897a8515d14be67>", BInteger 2000000000000000000),
            (".balances<a:eced1be28e67d740d541e69b75065ce211e822c8>", BInteger 1000000000000000000),
            (".balances<a:ee581621ce821bef1940b436eea08d81037b9651>", BInteger 1000000000000000000),
            (".balances<a:ee8b16119f8876181d449e59aa1cd094064f227b>", BInteger 6760000000000000000),
            (".balances<a:efbc23f6d1fc418098731ecf2838fcd9e06002df>", BInteger 1200000000000000000),
            (".balances<a:f06270f0d6b36bde60030871ed1ef26be1ef1e03>", BInteger 1000000000000000000),
            (".balances<a:f18dd88f4d7b8c44988711d9d4a9328b29a3ee15>", BInteger 30402000000000000000),
            (".balances<a:f1ba16a6cfb2a17fb34ad477eaaf0c76eac64f14>", BInteger 15200000000000000000),
            (".balances<a:f1bdfcdf4e5bc51c066f94d648696b5d80370e7c>", BInteger 40000000000000000),
            (".balances<a:f1e6c92d5b8dd76b7a3a7fdf23f20dc7c5cfc3e0>", BInteger 2000000000000000000),
            (".balances<a:f21fa794aa67ac34e793ab216c60be7c60bfd62f>", BInteger 1160000000000000000),
            (".balances<a:f222c0d468c5ac00685e9561baf108fd5ada216d>", BInteger 500000000000000000),
            (".balances<a:f2e056b903b0c3b02fdf1b44a77a351c27d97d77>", BInteger 5000000000000000000),
            (".balances<a:f3571688e7dddc498cd7de421cf6114bea4eb2b4>", BInteger 1000000000000000000),
            (".balances<a:f3ac489ad47953cc5e21875315e91d90108cba7a>", BInteger 1000000000000000000),
            (".balances<a:f43b9df553e643b2126494e2eb7a302be924dc0b>", BInteger 1000000000000000000),
            (".balances<a:f460bd196bb5e6af21cf7b6e700d9b8df972d3fc>", BInteger 1000000000000000000),
            (".balances<a:f4778cee538e86c3116e315d10af34b82be34081>", BInteger 4000000000000000000),
            (".balances<a:f4a560a5c536ee9f99e256c6b6c4edaa404c99d1>", BInteger 1000000000000000000),
            (".balances<a:f4a87ab741f4704207072464f06618904cf12c98>", BInteger 1000000000000000000),
            (".balances<a:f4c2abc44e836c4c2e16e8d9efb787e68e175e65>", BInteger 1000000000000000000),
            (".balances<a:f56985aaa3f0d2281d32a2416107087213bc5b7d>", BInteger 1200000000000000000),
            (".balances<a:f5d1e1b00ff2ca21951dd3e303d2d265daf7c460>", BInteger 5000000000000000000),
            (".balances<a:f5e0d8a2b852360bc2f25fdf3113363d3c237b2b>", BInteger 100000000000000000),
            (".balances<a:f5e49efa00c459509a12f4c72057498a94723fb6>", BInteger 1000000000000000000),
            (".balances<a:f5f3818b5d8be15c04c4d2da1e9d0e279f30d32e>", BInteger 1000000000000000000),
            (".balances<a:f616f9fa39de8ed726c4076ca32433b554eecfa8>", BInteger 1000000000000000000),
            (".balances<a:f66c7eb2c2ac226185bf0dad329f302a2c61a662>", BInteger 1000000000000000000),
            (".balances<a:f6eebc5929faeb0f67b74290e090680b2a031101>", BInteger 18450000000000000000),
            (".balances<a:f828be88a2a1b17c2ccf6883c69b117dc1d29577>", BInteger 1000000000000000000000),
            (".balances<a:f90f2aa9d7806c34529b259cbeaaaec5c8606d58>", BInteger 5500000000000000000),
            (".balances<a:f94a81021a727610016d723040f489364ffd300f>", BInteger 100000000000000000),
            (".balances<a:fa3ff951d6bb18d6047e866c98c3cbe46e6d1b96>", BInteger 1000000000000000000000),
            (".balances<a:fa582d0037e821beb5ccf3890657fecff7b292d8>", BInteger 500000000000000000),
            (".balances<a:fa7133e60676da1ae53f50a517409e940fa0f1d4>", BInteger 2962515200000000000000),
            (".balances<a:fb98e9011e6ccb58ded89c288cd07d0927738683>", BInteger 500000000000000000),
            (".balances<a:fba24ec5b178a4ecfe1e078ef7cb934d12da7754>", BInteger 500000000000000000),
            (".balances<a:fbca5ecb9b24bbc1b310c031b9860fa72d1ecc50>", BInteger 1000000000000000000),
            (".balances<a:fccb1ae346091aa6081b655874f23e728f5e1a72>", BInteger 1000000000000000000),
            (".balances<a:fd3dc24c678145ce28dc2758abf6252da0635ee7>", BInteger 200000000000000000),
            (".balances<a:fe02621f6a66c30b72d773203a424d81f4b50689>", BInteger 5000000000000000000),
            (".balances<a:fe207416f9b875d2f5604f21ce4e2dd6344f9b9c>", BInteger 1000000000000000000),
            (".balances<a:fe6fa3c2cb5b52a8e09906149e207ce738b4b37c>", BInteger 5000000000000000000),
            (".balances<a:fe7349b08cb8cd8a816a806e653152549cf72ee3>", BInteger 300000000000000000),
            (".balances<a:feb2b9b46152372070aec58c35fd2ad7b92abbad>", BInteger 200000000000000000),
            (".balances<a:feeb9e8b5896cac28deb8f880f0a6d43fd6cafa3>", BInteger 1000000000000000000),
            (".balances<a:ff24695b6ece8f0ace53e198263ccb276d9cbb31>", BInteger 322200000000000000000),
            (".balances<a:ff9dc1266da2d2b9e8950b070139f65867856d6b>", BInteger 1200000000000000000),
            (".balances<a:fff2f5aebfbac31129db5890a4ba4c79fafd5cb3>", BInteger 500000000000000000)
          ]

rateStrategy :: AccountInfo
rateStrategy = SolidVMContractWithStorage rateStrategyAddress 0 (CodeAtAccount mercataAddress "RateStrategy") $ createdByBlockApps mercataAddress

priceOracle :: AccountInfo
priceOracle = SolidVMContractWithStorage priceOracleAddress 0 (CodeAtAccount mercataAddress "PriceOracle") $
  (".prices<a:" <> addrBS usdstAddress <> ">", BInteger 1000000000000000000)
  : (".authorizedOracles<a:" <> addrBS usdstAddress <> ">", BBool True)
  : ownedByBlockApps mercataAddress
  ++ mapMaybe (\GR.Reserve{..} -> flip fmap (M.lookup assetRootAddress assetMap) $ \a ->
    (".prices<a:" <> addrBS assetRootAddress <> ">", BInteger . round $ lastUpdatedOraclePrice * (10.0 ** (fromInteger $ 18 + getDecimals (GA.decimals a) (GA.name a))))
  ) GR.reserves

collateralVault :: AccountInfo
collateralVault = SolidVMContractWithStorage collateralVaultAddress 0 (CodeAtAccount mercataAddress "CollateralVault") $ ownedByBlockApps mercataAddress ++
  [ (".registry", BContract "LendingRegistry" $ unspecifiedChain lendingRegistryAddress)
  ] ++ concatMap (\GE.Escrow{..} ->
      [ (".userCollaterals<a:" <> addrBS borrower <> "><a:" <> addrBS assetRootAddress <> ">", BInteger collateralQuantity)
      ]
  ) combinedEscrows

liquidityPool :: AccountInfo
liquidityPool = SolidVMContractWithStorage liquidityPoolAddress 0 (CodeAtAccount mercataAddress "LiquidityPool") $ ownedByBlockApps mercataAddress ++
  [ (".registry", BContract "LendingRegistry" $ unspecifiedChain lendingRegistryAddress)
  , (".mToken", BContract "Token" $ unspecifiedChain mTokenAddress)
  ]

lendingPool :: AccountInfo
lendingPool = SolidVMContractWithStorage lendingPoolAddress 0 (CodeAtAccount mercataAddress "LendingPool") $ ownedByBlockApps mercataAddress ++
  [ (".registry", BContract "LendingRegistry" $ unspecifiedChain lendingRegistryAddress)
  , (".poolConfigurator", BAccount $ unspecifiedChain poolConfiguratorAddress)
  , (".tokenFactory", BContract "TokenFactory" $ unspecifiedChain tokenFactoryAddress)
  , (".feeCollector", BContract "FeeCollector" $ unspecifiedChain feeCollectorAddress)
  , (".borrowableAsset", BAccount $ unspecifiedChain usdstAddress)
  , (".mToken", BAccount $ unspecifiedChain mTokenAddress)
  ] ++
  [ (".assetConfigs<a:" <> addrBS usdstAddress <> ">.ltv", BInteger 7500)
  , (".assetConfigs<a:" <> addrBS usdstAddress <> ">.interestRate", BInteger 500)
  , (".assetConfigs<a:" <> addrBS usdstAddress <> ">.reserveFactor", BInteger 1000)
  , (".assetConfigs<a:" <> addrBS usdstAddress <> ">.liquidationBonus", BInteger 10500)
  , (".assetConfigs<a:" <> addrBS usdstAddress <> ">.liquidationThreshold", BInteger 8000)
  , (".configuredAssets[0]", BAccount $ unspecifiedChain usdstAddress)
  , (".configuredAssets.length", BInteger . fromIntegral $ 1 + length GR.reserves)
  ] ++ concatMap (\(i, GR.Reserve{..}) ->
  [ (".assetConfigs<a:" <> addrBS assetRootAddress <> ">.ltv", BInteger 7500)
  , (".assetConfigs<a:" <> addrBS assetRootAddress <> ">.interestRate", BInteger 500)
  , (".assetConfigs<a:" <> addrBS assetRootAddress <> ">.reserveFactor", BInteger 1000)
  , (".assetConfigs<a:" <> addrBS assetRootAddress <> ">.liquidationBonus", BInteger 10500)
  , (".assetConfigs<a:" <> addrBS assetRootAddress <> ">.liquidationThreshold", BInteger 8000)
  , (".configuredAssets[" <> BC.pack (show i) <> "]", BAccount $ unspecifiedChain assetRootAddress)
  ]
  ) (zip [1 :: Integer ..] GR.reserves)
    ++ concatMap (\GE.Escrow{..} -> (if isActive && borrowedAmount > 0 then
  [ (".userLoan<a:" <> addrBS borrower <> ">.principalBalance", BInteger borrowedAmount)
  , (".userLoan<a:" <> addrBS borrower <> ">.interestOwed", BInteger 0)
  , (".userLoan<a:" <> addrBS borrower <> ">.lastIntCalculated", BInteger 1751860800) -- July 7th, 2025, 12:00:00 AM
  , (".userLoan<a:" <> addrBS borrower <> ">.lastUpdated", BInteger 1751860800) -- July 7th, 2025, 12:00:00 AM
  ] else [])
  ) combinedEscrows

poolConfigurator :: AccountInfo
poolConfigurator = SolidVMContractWithStorage poolConfiguratorAddress 0 (CodeAtAccount mercataAddress "PoolConfigurator") $ ownedByBlockApps mercataAddress ++
  [ (".registry", BContract "LendingRegistry" $ unspecifiedChain lendingRegistryAddress)
  ]

lendingRegistry :: AccountInfo
lendingRegistry = SolidVMContractWithStorage lendingRegistryAddress 0 (CodeAtAccount mercataAddress "LendingRegistry") $ ownedByBlockApps mercataAddress ++
  [ (".lendingPool", BContract "LendingPool" $ unspecifiedChain lendingPoolAddress)
  , (".liquidityPool", BContract "LiquidityPool" $ unspecifiedChain liquidityPoolAddress)
  , (".collateralVault", BContract "CollateralVault" $ unspecifiedChain collateralVaultAddress)
  , (".rateStrategy", BContract "RateStrategy" $ unspecifiedChain rateStrategyAddress)
  , (".priceOracle", BContract "PriceOracle" $ unspecifiedChain priceOracleAddress)
  ]

mercataEthBridge :: AccountInfo
mercataEthBridge = SolidVMContractWithStorage mercataEthBridgeAddress 0 (CodeAtAccount mercataAddress "MercataEthBridge") $ createdByBlockApps mercataAddress ++
  [ (".owner", BAccount $ unspecifiedChain blockappsAddress)
  , (".relayer", BAccount $ unspecifiedChain blockappsAddress)
  , (".tokenFactory", BContract "TokenFactory" $ unspecifiedChain tokenFactoryAddress)
  ]

onRamp :: AccountInfo
onRamp = SolidVMContractWithStorage onRampAddress 0 (CodeAtAccount mercataAddress "OnRamp") $ createdByBlockApps mercataAddress ++
  [ (".listingIdCounter", BInteger 0)
  , (".priceOracle", BContract "PriceOracle" $ unspecifiedChain priceOracleAddress)
  , (".tokenFactory", BContract "TokenFactory" $ unspecifiedChain tokenFactoryAddress)
  , (".adminRegistry", BContract "AdminRegistry" $ unspecifiedChain adminRegistryAddress)
  ]

poolFactory :: AccountInfo
poolFactory = SolidVMContractWithStorage poolFactoryAddress 0 (CodeAtAccount mercataAddress "PoolFactory") $ ownedByBlockApps mercataAddress ++
  [ (".tokenFactory", BAccount $ unspecifiedChain tokenFactoryAddress)
  , (".adminRegistry", BAccount $ unspecifiedChain adminRegistryAddress)
  , (".feeCollector", BAccount $ unspecifiedChain feeCollectorAddress)
  , (".swapFeeRate", BInteger 30)
  , (".lpSharePercent", BInteger 7000)
  ]

tokenFactory :: AccountInfo
tokenFactory = SolidVMContractWithStorage tokenFactoryAddress 0 (CodeAtAccount mercataAddress "TokenFactory") $ ownedByBlockApps mercataAddress
  ++ [ (".adminRegistry", BAccount $ unspecifiedChain adminRegistryAddress)
     , (".isFactoryToken<a:" <> addrBS mTokenAddress <> ">", BBool True)
     , (".allTokens[0]", BAccount $ unspecifiedChain mTokenAddress)
     , (".allTokens.length", BInteger . fromIntegral $ 1 + length GA.assets)
     ]
  ++ ((\GA.Asset{..} -> (".isFactoryToken<a:" <> addrBS root <> ">", BBool True)) <$> GA.assets)
  ++ ((\(i, GA.Asset{..}) -> (".allTokens[" <> BC.pack (show i) <> "]", BAccount $ unspecifiedChain root)) <$> zip [(1 :: Integer)..] GA.assets)

adminRegistry :: AccountInfo
adminRegistry = SolidVMContractWithStorage adminRegistryAddress 0 (CodeAtAccount mercataAddress "AdminRegistry") $ ownedByBlockApps mercataAddress
  ++ [(".isAdmin<a:" <> addrBS blockappsAddress <> ">", BBool True)]
  ++ [(".isAdmin<a:" <> addrBS poolFactoryAddress <> ">", BBool True)]

feeCollector :: AccountInfo
feeCollector = SolidVMContractWithStorage feeCollectorAddress 0 (CodeAtAccount mercataAddress "FeeCollector") $ ownedByBlockApps mercataAddress

voucher :: AccountInfo
voucher = SolidVMContractWithStorage voucherAddress 0 (CodeAtAccount mercataAddress "Voucher") $ ownedByBlockApps mercataAddress
  ++ [ ("._name", BString "Voucher")
     , ("._symbol", BString "VOUCHER")
     , ("._totalSupply", BInteger 0)
     , (".minters<a:" <> addrBS blockappsAddress <> ">", BBool True)
     , (".minters<a:" <> addrBS mercataEthBridgeAddress <> ">", BBool True)
     , ("._balances<a:" <> addrBS blockappsAddress <> ">", BInteger 1000000000000000000000000)
     ]

mToken :: AccountInfo
mToken = SolidVMContractWithStorage mTokenAddress 0 (CodeAtAccount mercataAddress "Token") $ ownedByBlockApps mercataAddress
  ++ [ ("._name", BString "MUSDST")
     , ("._symbol", BString "MUSDST")
     , (".description", BString "MUSDST")
     , (".customDecimals", BInteger 18)
     , ("._totalSupply", BInteger . (`div` 100) . (*110) . sum $ GE.borrowedAmount <$> combinedEscrows)
     , (".minters<a:" <> addrBS blockappsAddress <> ">", BBool True)
     , (".burners<a:" <> addrBS blockappsAddress <> ">", BBool True)
     , (".minters<a:" <> addrBS liquidityPoolAddress <> ">", BBool True)
     , (".burners<a:" <> addrBS liquidityPoolAddress <> ">", BBool True)
     , ("._balances<a:" <> addrBS blockappsAddress <> ">", BInteger . (`div` 100) . (*110) . sum $ GE.borrowedAmount <$> combinedEscrows)
     , (".admin", BAccount $ unspecifiedChain blockappsAddress)
     , (".tokenFactory", BContract "TokenFactory" $ unspecifiedChain tokenFactoryAddress)
     , (".status", BEnumVal "TokenStatus" "ACTIVE" 2)
     ]

rewardsManager :: AccountInfo
rewardsManager = SolidVMContractWithStorage rewardsManagerAddress 0 (CodeAtAccount mercataAddress "RewardsManager") $ ownedByBlockApps mercataAddress
  ++ [ (".rewardTokens[0]", BContract "Token" $ unspecifiedChain cataAddress)
     , (".rewardTokens.length", BInteger 1)
     , (".rewardTokenMap<a:" <> addrBS cataAddress <> ">", BInteger 1)
     , (".rewardDelegate", BAccount $ unspecifiedChain 0x0)
     , (".eligibleTokens.length", BInteger . fromIntegral $ length GR.reserves)
     ]
  ++ concatMap (\(i, GR.Reserve{..}) ->
    [ (".eligibleTokens[" <> BC.pack (show i) <> "]", BContract "Token" $ unspecifiedChain assetRootAddress)
    , (".eligibleTokenMap<a:" <> addrBS assetRootAddress <> ">", BInteger $ i + 1)
    ]
  ) (zip [0..] GR.reserves)

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

