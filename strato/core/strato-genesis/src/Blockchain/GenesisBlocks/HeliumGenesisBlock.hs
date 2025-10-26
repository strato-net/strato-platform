{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE NumericUnderscores #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes       #-}
{-# LANGUAGE RecordWildCards   #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TupleSections     #-}

module Blockchain.GenesisBlocks.HeliumGenesisBlock where

import           Blockchain.Data.GenesisInfo
import           Blockchain.GenesisBlocks.Contracts.Decide
import           Blockchain.GenesisBlocks.Contracts.GovernanceV2
import           Blockchain.GenesisBlocks.Contracts.Mercata
import           Blockchain.GenesisBlocks.Contracts.TH
import           Blockchain.GenesisBlocks.Contracts.UserRegistry
import qualified Blockchain.GenesisBlocks.Instances.GenesisAssets as GA
import qualified Blockchain.GenesisBlocks.Instances.GenesisEscrows as GE
import qualified Blockchain.GenesisBlocks.Instances.GenesisReserves as GR
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.Event
import qualified Blockchain.Strato.Model.Keccak256               as KECCAK256
import           Blockchain.Strato.Model.Validator
import           Blockchain.Stream.Action                        (Delegatecall(..))
import qualified Data.Aeson                                      as JSON
import           Data.ByteString                                 (ByteString)
import qualified Data.ByteString                                 as B
import qualified Data.ByteString.Char8                           as BC
import qualified Data.ByteString.Lazy                            as BL
import           Data.Default
import           Data.List                                       (find)
import qualified Data.Map.Strict                                 as M
import           Data.Maybe                                      (fromMaybe, mapMaybe)
import qualified Data.Sequence                                   as S
import qualified Data.Set                                        as Set
import           Data.String
import           Data.Text                                       (Text)
import qualified Data.Text                                       as T
import           Data.Text.Encoding
import           SolidVM.Model.Storable
import           System.FilePath                                 (takeFileName)

embeddedFiles :: [(FilePath, B.ByteString)]
embeddedFiles = $(typecheckAndEmbedFiles "resources" mercataContractFiles)

mercataContracts :: [[String]]
mercataContracts = map (\(fp, bs) -> [takeFileName fp, T.unpack $ decodeUtf8 bs]) embeddedFiles

data BridgeChainInfo = BridgeChainInfo
  { bci_chainId :: Integer
  , bci_chainName :: Text
  , bci_custody :: Address
  , bci_depositRouter :: Address
  , bci_enabled :: Bool
  , bci_lastProcessedBlock :: Integer
  }

data BridgeAssetInfo = BridgeAssetInfo
  { bai_enabled :: Bool
  , bai_externalChainId :: Integer
  , bai_externalDecimals :: Integer
  , bai_externalName :: Text
  , bai_externalSymbol :: Text
  , bai_externalToken :: Address
  , bai_maxPerWithdrawal :: Integer
  , bai_stratoToken :: Address
  }

data HeliumGenesisBlockConfig = HeliumGenesisBlockConfig
  { hgbc_validators :: [Validator]
  , hgbc_admins :: [Address]
  , hgbc_chainInfos :: [BridgeChainInfo]
  , hgbc_assetInfos :: [BridgeAssetInfo]
  , hgbc_bridgeRelayer :: (Address, Integer)
  , hgbc_oracleRelayers :: [(Address, Integer)]
  }

list :: b -> (a -> [a] -> b) -> [a] -> b
list onEmpty onCons as = case as of
  [] -> onEmpty
  (a:as') -> onCons a as'

gramsToOz :: Integer -> Integer
gramsToOz n = (10000 * n) `div` 283495

assetMap :: M.Map Address GA.Asset
assetMap = foldr (\k -> M.insert (GA.root k) k) M.empty GA.assets

usdstAsset :: GA.Asset
usdstAsset = list (error "usdstAsset: No asset named USDST found") const $ filter ((== "USDST") . GA.name) GA.assets

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

bridgeRelayerAddress :: Address
bridgeRelayerAddress = 0x72b572ed77397da1ece4768cb2fec1943e1af7cb

oracleAddress1 :: Address
oracleAddress1 = 0x61960004350908061a90246f50ef2ab9d4b4f2c9

oracleAddress2 :: Address
oracleAddress2 = 0x11298e3fd793aab22178d185ef7cedff24dbec7d

ethstRoot :: Address
ethstRoot = 0x93fb7295859b2d70199e0a4883b7c320cf874e6c

wbtcstRoot :: Address
wbtcstRoot = 0x7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9

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

-- paxgstRoot :: Address
-- paxgstRoot = 0x491cdfe98470bfe69b662ab368826dca0fc2f24d

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

mercataBridgeAddress :: Address
mercataBridgeAddress = 0x1008

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

cdpEngineAddress :: Address
cdpEngineAddress = 0x1011

cdpRegistryAddress :: Address
cdpRegistryAddress = 0x1012

cdpVaultAddress :: Address
cdpVaultAddress = 0x1013

cdpReserveAddress :: Address
cdpReserveAddress = 0x1014

safetyModuleAddress :: Address
safetyModuleAddress = 0x1015

sUsdstAddress :: Address
sUsdstAddress = 0x1016

rewardsChefAddress :: Address
rewardsChefAddress = 0x101f

-- paxgstPoolAddress :: Address
-- paxgstPoolAddress = 0x1023
--
-- paxgstLpTokenAddress :: Address
-- paxgstLpTokenAddress = 0x1024

rateStrategyImplAddress :: Address
rateStrategyImplAddress = 0x1101

priceOracleImplAddress :: Address
priceOracleImplAddress = 0x1102

collateralVaultImplAddress :: Address
collateralVaultImplAddress = 0x1103

liquidityPoolImplAddress :: Address
liquidityPoolImplAddress = 0x1104

lendingPoolImplAddress :: Address
lendingPoolImplAddress = 0x1105

poolConfiguratorImplAddress :: Address
poolConfiguratorImplAddress = 0x1106

lendingRegistryImplAddress :: Address
lendingRegistryImplAddress = 0x1107

mercataBridgeImplAddress :: Address
mercataBridgeImplAddress = 0x1108

poolFactoryImplAddress :: Address
poolFactoryImplAddress = 0x110a

tokenFactoryImplAddress :: Address
tokenFactoryImplAddress = 0x110b

adminRegistryImplAddress :: Address
adminRegistryImplAddress = 0x110c

feeCollectorImplAddress :: Address
feeCollectorImplAddress = 0x110d

voucherImplAddress :: Address
voucherImplAddress = 0x110e

tokenImplAddress :: Address
tokenImplAddress = 0x110f

poolImplAddress :: Address
poolImplAddress = 0x1117

cdpEngineImplAddress :: Address
cdpEngineImplAddress = 0x1111

cdpRegistryImplAddress :: Address
cdpRegistryImplAddress = 0x1112

cdpVaultImplAddress :: Address
cdpVaultImplAddress = 0x1113

cdpReserveImplAddress :: Address
cdpReserveImplAddress = 0x1114

safetyModuleImplAddress :: Address
safetyModuleImplAddress = 0x1115

rewardsChefImplAddress :: Address
rewardsChefImplAddress = 0x111f

toPaths :: [(ByteString, a)] -> [(StoragePath, a)]
toPaths = map (\(k, v) -> (fromString $ BC.unpack k, v))

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

supportedCollaterals :: [Address]
supportedCollaterals = Set.toList
                     . Set.delete 0xd6e292f2c9486ada24f6d5cf2e67f44c5f7f677a -- BETHTEMP
                     . Set.delete 0x04d68c24ff359ab457c7b96810f85c51989fe8ed -- USDTEMP
                     . Set.fromList
                     $ GE.assetRootAddress <$> combinedEscrows

mercataContract :: String -> CodePtr
mercataContract = flip SolidVMCode (KECCAK256.hash $ BL.toStrict $ JSON.encode mercataContracts)

proxy :: CodePtr
proxy = mercataContract "Proxy"

implContract :: Address -> String -> AddressInfo
implContract implAddress contractName =
  SolidVMContractWithStorage implAddress 0 (mercataContract contractName) $ toPaths $ ownedByBlockApps implAddress

sepoliaChainId :: Integer
sepoliaChainId = 11155111

ethChainId :: Integer
ethChainId = 1

sepolia :: BridgeChainInfo
sepolia = BridgeChainInfo sepoliaChainId
  "Ethereum Sepolia"
  0x8713850e9ff0fd0200ce87c32e3cdb24ed021631
  0x1f0457D1d8c3f0dA3e579bE3843DD6E093163B84
  True
  9217425

eth :: BridgeAssetInfo
eth = BridgeAssetInfo
  True
  sepoliaChainId
  18
  "Ether"
  "ETH"
  0x0000000000000000000000000000000000000000
  0
  0x93fb7295859b2d70199e0a4883b7c320cf874e6c

wbtc :: BridgeAssetInfo
wbtc = BridgeAssetInfo
  True
  sepoliaChainId
  8
  "Wrapped Bitcoin"
  "WBTC"
  0x29f2d40b0605204364af54ec677bd022da425d03
  0
  0x7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9
  

paxg :: BridgeAssetInfo
paxg = BridgeAssetInfo
  True
  sepoliaChainId
  18
  "PAXG"
  "PAXG"
  0x8599ea38e03e9d0a8b9e86a47ac119fc78d6b6d3
  0
  0x491cdfe98470bfe69b662ab368826dca0fc2f24d

usdc :: BridgeAssetInfo
usdc = BridgeAssetInfo
  True
  sepoliaChainId
  6
  "USDC"
  "USDC"
  0x94a9d9ac8a22534e3faca9f4e7f2e2cf85d5e4c8
  0
  usdstAddress

usdt :: BridgeAssetInfo
usdt = BridgeAssetInfo
  True
  sepoliaChainId
  6
  "USDT"
  "USDT"
  0xaa8e23fb1079ea71e0a56f48a2aa51851d8433d0
  0
  usdstAddress

heliumConfig :: HeliumGenesisBlockConfig
heliumConfig = HeliumGenesisBlockConfig
  validators
  admins
  [sepolia]
  [eth, wbtc, paxg, usdc, usdt]
  (bridgeRelayerAddress, 100_000 * oneE18)
  ((,100_000 * oneE18) <$> [oracleAddress1, oracleAddress2])

genesisBlock :: GenesisInfo
genesisBlock = genesisBlockTemplate heliumConfig

genesisBlockTemplate :: HeliumGenesisBlockConfig -> GenesisInfo
genesisBlockTemplate HeliumGenesisBlockConfig{..} =
  insertMercataGovernanceContract adminRegistryAddress hgbc_validators [adminRegistryAddress]
  . insertUserRegistryContract
  . insertDecideContract
  $ def{
        logBloom=B.replicate 256 0,
        addressInfo=[
            NonContract 0xe1fd0d4a52b75a694de8b55528ad48e2e2cf7859 1809251394333065553493296640760748560207343510400633813116524750123642650624,
            implContract rateStrategyImplAddress "RateStrategy",
            implContract priceOracleImplAddress "PriceOracle",
            implContract collateralVaultImplAddress "CollateralVault",
            implContract liquidityPoolImplAddress "LiquidityPool",
            implContract lendingPoolImplAddress "LendingPool",
            implContract poolConfiguratorImplAddress "PoolConfigurator",
            implContract lendingRegistryImplAddress "LendingRegistry",
            implContract mercataBridgeImplAddress "MercataBridge",
            implContract poolFactoryImplAddress "PoolFactory",
            implContract tokenFactoryImplAddress "TokenFactory",
            implContract adminRegistryImplAddress "AdminRegistry",
            implContract feeCollectorImplAddress "FeeCollector",
            implContract voucherImplAddress "Voucher",
            implContract tokenImplAddress "Token",
            implContract poolImplAddress "Pool",
            implContract cdpEngineImplAddress "CDPEngine",
            implContract cdpRegistryImplAddress "CDPRegistry",
            implContract cdpVaultImplAddress "CDPVault",
            implContract cdpReserveImplAddress "CDPReserve",
            implContract safetyModuleImplAddress "SafetyModule",
            implContract rewardsChefImplAddress "RewardsChef",
            SolidVMContractWithStorage
              mercataAddress
              720
              (SolidVMCode "Mercata" (KECCAK256.hash $ BL.toStrict $ JSON.encode mercataContracts))
              [ (".:creator", BString $ encodeUtf8 "BlockApps")
              , (".:creatorAddress", BAddress blockappsAddress)
              , (".:originAddress", BAddress mercataAddress)
              , (".rateStrategy", BContract "RateStrategy" rateStrategyAddress)
              , (".priceOracle", BContract "PriceOracle" priceOracleAddress)
              , (".collateralVault", BContract "CollateralVault" collateralVaultAddress)
              , (".liquidityPool", BContract "LiquidityPool" liquidityPoolAddress)
              , (".lendingPool", BContract "LendingPool" lendingPoolAddress)
              , (".poolConfigurator", BContract "PoolConfigurator" poolConfiguratorAddress)
              , (".lendingRegistry", BContract "LendingRegistry" lendingRegistryAddress)
              , (".mercataBridge", BContract "MercataBridge" mercataBridgeAddress)
              , (".poolFactory", BContract "PoolFactory" poolFactoryAddress)
              , (".tokenFactory", BContract "TokenFactory" tokenFactoryAddress)
              , (".feeCollector", BContract "FeeCollector" feeCollectorAddress)
              , (".adminRegistry", BContract "AdminRegistry" adminRegistryAddress)
              , (".rewardsChef", BContract "RewardsChef" rewardsChefAddress)
              , (".cdpEngine", BContract "CDPEngine" cdpEngineAddress)
              , (".cdpRegistry", BContract "CDPRegistry" cdpRegistryAddress)
              , (".cdpVault", BContract "CDPVault" cdpVaultAddress)
              , (".cdpReserve", BContract "CDPReserve" cdpReserveAddress)
              , (".safetyModule", BContract "SafetyModule" safetyModuleAddress)
              ]
            ] ++ mapMaybe assetToAddressInfos GA.assets ++
            [ rateStrategy
            , priceOracle
            , collateralVault
            , liquidityPool
            , lendingPool
            , poolConfigurator
            , lendingRegistry
            , mercataBridge hgbc_chainInfos hgbc_assetInfos
            , poolFactory
            , tokenFactory
            , adminRegistry hgbc_admins (fst hgbc_bridgeRelayer) (fst <$> hgbc_oracleRelayers)
            , feeCollector
            , voucher $ hgbc_bridgeRelayer : hgbc_oracleRelayers
            , mToken
            , rewardsChef
            , cdpEngine
            , cdpRegistry
            , cdpVault
            , cdpReserve
            , safetyModule
            , sUsdst
            -- , paxgstPool
            -- , paxgstLpToken
            ],
        codeInfo=[CodeInfo (decodeUtf8 $ BL.toStrict $ JSON.encode mercataContracts) (Just "Mercata")],
        events = M.fromList $
          (assetToEvents <$> GA.assets)
          ++ [ adminEvents
             , lendingPoolEvents
             , poolConfiguratorEvents
             , cdpEngineEvents
             , cdpRegistryEvents
             , cdpVaultEvents
             , safetyModuleEvents
             ],
        delegatecalls = M.fromList . map (fmap S.singleton) $
          ((\t -> (GA.root t, Delegatecall (GA.root t) tokenImplAddress "BlockApps" "Mercata" "Token")) <$> GA.assets)
          ++ [ (rateStrategyAddress, Delegatecall rateStrategyAddress rateStrategyImplAddress "BlockApps" "Mercata" "RateStrategy")
             , (priceOracleAddress, Delegatecall priceOracleAddress priceOracleImplAddress "BlockApps" "Mercata" "PriceOracle")
             , (collateralVaultAddress, Delegatecall collateralVaultAddress collateralVaultImplAddress "BlockApps" "Mercata" "CollateralVault")
             , (liquidityPoolAddress, Delegatecall liquidityPoolAddress liquidityPoolImplAddress "BlockApps" "Mercata" "LiquidityPool")
             , (lendingPoolAddress, Delegatecall lendingPoolAddress lendingPoolImplAddress "BlockApps" "Mercata" "LendingPool")
             , (poolConfiguratorAddress, Delegatecall poolConfiguratorAddress poolConfiguratorImplAddress "BlockApps" "Mercata" "PoolConfigurator")
             , (lendingRegistryAddress, Delegatecall lendingRegistryAddress lendingRegistryImplAddress "BlockApps" "Mercata" "LendingRegistry")
             , (mercataBridgeAddress, Delegatecall mercataBridgeAddress mercataBridgeImplAddress "BlockApps" "Mercata" "MercataBridge")
             , (poolFactoryAddress, Delegatecall poolFactoryAddress poolFactoryImplAddress "BlockApps" "Mercata" "PoolFactory")
             , (tokenFactoryAddress, Delegatecall tokenFactoryAddress tokenFactoryImplAddress "BlockApps" "Mercata" "TokenFactory")
             , (adminRegistryAddress, Delegatecall adminRegistryAddress adminRegistryImplAddress "BlockApps" "Mercata" "AdminRegistry")
             , (feeCollectorAddress, Delegatecall feeCollectorAddress feeCollectorImplAddress "BlockApps" "Mercata" "FeeCollector")
             , (voucherAddress, Delegatecall voucherAddress voucherImplAddress "BlockApps" "Mercata" "Voucher")
             , (mTokenAddress, Delegatecall mTokenAddress tokenImplAddress "BlockApps" "Mercata" "Token")
             , (cdpEngineAddress, Delegatecall cdpEngineAddress cdpEngineImplAddress "BlockApps" "Mercata" "CDPEngine")
             , (cdpRegistryAddress, Delegatecall cdpRegistryAddress cdpRegistryImplAddress "BlockApps" "Mercata" "CDPRegistry")
             , (cdpVaultAddress, Delegatecall cdpVaultAddress cdpVaultImplAddress "BlockApps" "Mercata" "CDPVault")
             , (cdpReserveAddress, Delegatecall cdpReserveAddress cdpReserveImplAddress "BlockApps" "Mercata" "CDPReserve")
             , (safetyModuleAddress, Delegatecall safetyModuleAddress safetyModuleImplAddress "BlockApps" "Mercata" "SafetyModule")
             , (rewardsChefAddress, Delegatecall rewardsChefAddress rewardsChefImplAddress "BlockApps" "Mercata" "RewardsChef")
             , (sUsdstAddress, Delegatecall sUsdstAddress tokenImplAddress "BlockApps" "Mercata" "Token")
             ]
        }

createdByBlockApps :: Address -> [(B.ByteString, BasicValue)]
createdByBlockApps originAddress =
  [ (".:creator", BString $ encodeUtf8 "BlockApps")
  , (".:creatorAddress", BAddress blockappsAddress)
  , (".:originAddress", BAddress originAddress)
  ]

ownedByBlockApps :: Address -> [(B.ByteString, BasicValue)]
ownedByBlockApps originAddress = ("._owner", BAddress adminRegistryAddress) : createdByBlockApps originAddress

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

oneE18 :: Integer
oneE18 = 1_000_000_000_000_000_000

ray :: Integer
ray = 1_000_000_000 * oneE18

lastAccrual :: Integer
lastAccrual = 1761192000 -- October 23th, 2025, 12:00:00 AM

assetBalances :: GA.Asset -> [(Address, Integer)]
assetBalances GA.Asset{..} =
  M.toList
    . foldr (uncurry $ M.insertWith (+)) M.empty
    . concatMap (\(o, q) ->
        let mEscrowBalance = correctQuantity decimals name . GE.collateralQuantity
                         <$> find (\e -> GE.borrower e == o && GE.assetRootAddress e == root) combinedEscrows
         in case mEscrowBalance of
              Nothing -> [(o, q)]
              Just escrowBalance -> [(o, max 0 $ q - escrowBalance), (cdpVaultAddress, escrowBalance)])
    . concatMap (\case
      (GA.Balance _ o c q)
        | root == usdstAddress &&  c == "mercata_usdst" ->
            [ (blockappsAddress, correctQuantity decimals name q)
            ]
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

assetToAddressInfos :: GA.Asset -> Maybe AddressInfo
assetToAddressInfos asset@GA.Asset{..} =
  let accountBalances' = assetBalances asset
      allBalances = (\(a, b) -> ("._balances[" <> addrBS a <> "]", BInteger b)) <$> accountBalances'
      takeCaps = T.pack . filter (\c -> (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) . T.unpack
      name' = if root == silvstRoot then "SILVST" else name
      description' = fromMaybe description $ M.lookup name' descriptions
   in case allBalances of
        [] -> Nothing
        _ -> Just . SolidVMContractWithStorage root 0 proxy $ toPaths $
          ownedByBlockApps root ++
          [ (".logicContract", BAddress tokenImplAddress)
          , ("._name", BString $ encodeUtf8 name')
          , ("._symbol", if root == silvstRoot then BString "SILVST" else BString $ encodeUtf8 $ takeCaps name)
          , ("._erc20Initialized", BBool True)
          , (".description", BString $ encodeUtf8 description')
          , (".customDecimals", BInteger 18)
          , ("._totalSupply", BInteger . sum $ (\(_, v) -> case v of BInteger i -> i; _ -> 0) <$> allBalances)
          , (".tokenFactory", BContract "TokenFactory" tokenFactoryAddress)
          , (".images.length", BInteger . fromIntegral $ length images)
          , (".files.length", BInteger . fromIntegral $ length files)
          , (".fileNames.length", BInteger . fromIntegral $ length fileNames)
          ] ++ map (\(k,v) -> (".images[" <> encodeUtf8 (T.pack $ show k) <> "]", BString $ encodeUtf8 v)) (M.toList images)
            ++ map (\(k,v) -> (".files[" <> encodeUtf8 (T.pack $ show k) <> "]", BString $ encodeUtf8 v)) (M.toList files)
            ++ map (\(k,v) -> (".fileNames[" <> encodeUtf8 (T.pack $ show k) <> "]", BString $ encodeUtf8 v)) (M.toList fileNames)
            ++ map (\(k,v) -> (".attributes[" <> encodeUtf8 (T.pack $ show k) <> "]", BString $ encodeUtf8 v)) (M.toList assetData)
            ++ [(maybe (".status", if root == usdstAddress then BEnumVal "TokenStatus" "ACTIVE" 2 else BEnumVal "TokenStatus" "LEGACY" 3)
                (const (".status", if not (name `elem` ["USDCST", "USDTST"]) then BEnumVal "TokenStatus" "ACTIVE" 2 else BEnumVal "TokenStatus" "LEGACY" 3))
                $ find (== root) supportedCollaterals)]
            ++ allBalances

assetToEvents :: GA.Asset -> (Address, S.Seq Event)
assetToEvents asset = (\(a, evs) -> (a, (\(n,v) -> Event KECCAK256.zeroHash "BlockApps" "Mercata" "Token" a n ((\(v1,v2) -> (v1,v2,"Other")) <$> v)) <$> evs)) (GA.root asset, S.fromList $
    ("Transfer", [("from", show $ Address 0),("to", show blockappsAddress),("value", show totalSupply)]) :
    ((\(a,b) -> ("Transfer", [("from", show blockappsAddress),("to", show a),("value", show b)])) <$> allBalances)
  )
  where
    allBalances = assetBalances asset
    totalSupply = sum $ snd <$> allBalances

-- To be deleted
rateStrategy :: AddressInfo
rateStrategy = SolidVMContractWithStorage rateStrategyAddress 0 proxy $ toPaths $ ownedByBlockApps mercataAddress
  ++ [(".logicContract", BAddress rateStrategyImplAddress)]

priceOracle :: AddressInfo
priceOracle = SolidVMContractWithStorage priceOracleAddress 0 proxy $ toPaths $
  (".logicContract", BAddress priceOracleImplAddress)
  : (".prices[" <> addrBS usdstAddress <> "]", BInteger oneE18)
  : (".authorizedOracles[" <> addrBS usdstAddress <> "]", BBool True)
  : ownedByBlockApps mercataAddress
  ++ mapMaybe (\GR.Reserve{..} -> flip fmap (M.lookup assetRootAddress assetMap) $ \a ->
    (".prices[" <> addrBS assetRootAddress <> "]", BInteger . round $ lastUpdatedOraclePrice * (10.0 ** (fromInteger $ 18 + getDecimals (GA.decimals a) (GA.name a))))
  ) GR.reserves

collateralVault :: AddressInfo
collateralVault = SolidVMContractWithStorage collateralVaultAddress 0 proxy $ toPaths $ ownedByBlockApps mercataAddress ++
  [ (".registry", BContract "LendingRegistry" lendingRegistryAddress)
  , (".logicContract", BAddress collateralVaultImplAddress)
  ]

liquidityPool :: AddressInfo
liquidityPool = SolidVMContractWithStorage liquidityPoolAddress 0 proxy $ toPaths $ ownedByBlockApps mercataAddress ++
  [ (".registry", BContract "LendingRegistry" lendingRegistryAddress)
  , (".logicContract", BAddress liquidityPoolImplAddress)
  , (".mToken", BContract "Token" mTokenAddress)
  ]

lendingPool :: AddressInfo
lendingPool = SolidVMContractWithStorage lendingPoolAddress 0 proxy $ toPaths $ ownedByBlockApps mercataAddress ++
  [ (".registry", BContract "LendingRegistry" lendingRegistryAddress)
  , (".logicContract", BAddress lendingPoolImplAddress)
  , (".poolConfigurator", BAddress poolConfiguratorAddress)
  , (".tokenFactory", BContract "TokenFactory" tokenFactoryAddress)
  , (".feeCollector", BContract "FeeCollector" feeCollectorAddress)
  , (".safetyModule", BContract "SafetyModule" safetyModuleAddress)
  , (".borrowableAsset", BAddress usdstAddress)
  , (".mToken", BAddress mTokenAddress)
  , (".RAY", BInteger ray)
  , (".SECONDS_PER_YEAR", BInteger 31536000)
  , (".borrowIndex", BInteger ray)
  , (".lastAccrual", BInteger lastAccrual)
  , (".totalScaledDebt", BInteger 0)
  , (".reservesAccrued", BInteger 0)
  , (".debtCeilingAsset", BInteger $ 1_000_000 * oneE18)
  , (".debtCeilingUSD", BInteger 0)
  , (".badDebt", BInteger 0)
  , (".safetyShareBps", BInteger 1000)
  ] ++
  [ (".assetConfigs[" <> addrBS usdstAddress <> "].ltv", BInteger 7500)
  , (".assetConfigs[" <> addrBS usdstAddress <> "].interestRate", BInteger 500)
  , (".assetConfigs[" <> addrBS usdstAddress <> "].reserveFactor", BInteger 1000)
  , (".assetConfigs[" <> addrBS usdstAddress <> "].liquidationBonus", BInteger 10500)
  , (".assetConfigs[" <> addrBS usdstAddress <> "].liquidationThreshold", BInteger 8000)
  , (".assetConfigs[" <> addrBS usdstAddress <> "].perSecondFactorRAY", BInteger $ ray + 1_547_125_956_666_413_085)
  , (".configuredAssets[0]", BAddress usdstAddress)
  , (".configuredAssets.length", BInteger . fromIntegral $ 1 + length supportedCollaterals)
  ] ++ concatMap (\(i, a) ->
  [ (".assetConfigs[" <> addrBS a <> "].ltv", BInteger 7500)
  , (".assetConfigs[" <> addrBS a <> "].interestRate", BInteger 500)
  , (".assetConfigs[" <> addrBS a <> "].reserveFactor", BInteger 1000)
  , (".assetConfigs[" <> addrBS a <> "].liquidationBonus", BInteger 10500)
  , (".assetConfigs[" <> addrBS a <> "].liquidationThreshold", BInteger 8000)
  , (".assetConfigs[" <> addrBS a <> "].perSecondFactorRAY", BInteger $ ray + 1_547_125_956_666_413_085)
  , (".configuredAssets[" <> BC.pack (show i) <> "]", BAddress a)
  ]
  ) (zip [1 :: Integer ..] supportedCollaterals)

lendingPoolEvents :: (Address, S.Seq Event)
lendingPoolEvents = (\(a, evs) -> (a, (\(n,v) -> Event KECCAK256.zeroHash "BlockApps" "Mercata" "LendingPool" a n ((\(v1,v2) -> (v1,v2,"Other")) <$> v)) <$> evs)) (lendingPoolAddress, S.fromList $
  map (\a -> ("AssetConfigured",
    [("asset", show a),
     ("ltv", "7500"),
     ("liquidationThreshold", "8000"),
     ("liquidationBonus", "10500"),
     ("interestRate", "500"),
     ("reserveFactor", "1000")
    ])
  ) supportedCollaterals
  )

poolConfigurator :: AddressInfo
poolConfigurator = SolidVMContractWithStorage poolConfiguratorAddress 0 proxy $ toPaths $ ownedByBlockApps mercataAddress ++
  [ (".registry", BContract "LendingRegistry" lendingRegistryAddress)
  , (".logicContract", BAddress poolConfiguratorImplAddress)
  ]

poolConfiguratorEvents :: (Address, S.Seq Event)
poolConfiguratorEvents = (\(a, evs) -> (a, (\(n,v) -> Event KECCAK256.zeroHash "BlockApps" "Mercata" "PoolConfigurator" a n ((\(v1,v2) -> (v1,v2,"Other")) <$> v)) <$> evs)) (poolConfiguratorAddress, S.fromList $
  map (\a -> ("AssetConfigured",
    [("asset", show a),
     ("ltv", "7500"),
     ("liquidationThreshold", "8000"),
     ("liquidationBonus", "10500"),
     ("interestRate", "500")
    ])
  ) supportedCollaterals
  )

lendingRegistry :: AddressInfo
lendingRegistry = SolidVMContractWithStorage lendingRegistryAddress 0 proxy $ toPaths $ ownedByBlockApps mercataAddress ++
  [ (".lendingPool", BContract "LendingPool" lendingPoolAddress)
  , (".logicContract", BAddress lendingRegistryImplAddress)
  , (".liquidityPool", BContract "LiquidityPool" liquidityPoolAddress)
  , (".collateralVault", BContract "CollateralVault" collateralVaultAddress)
  , (".rateStrategy", BContract "RateStrategy" rateStrategyAddress)
  , (".priceOracle", BContract "PriceOracle" priceOracleAddress)
  ]

mercataBridge :: [BridgeChainInfo] -> [BridgeAssetInfo] -> AddressInfo
mercataBridge bcis bais = SolidVMContractWithStorage mercataBridgeAddress 0 proxy $ toPaths $ ownedByBlockApps mercataAddress ++
  [ (".logicContract", BAddress mercataBridgeImplAddress)
  , (".tokenFactory", BContract "TokenFactory" tokenFactoryAddress)
  , (".depositsPaused", BBool False)
  , (".withdrawalCounter", BInteger 0)
  , (".withdrawalsPaused", BBool False)
  , (".WITHDRAWAL_ABORT_DELAY", BInteger 172800)
  , (".DECIMAL_PLACES", BInteger 18)
  , (".USDST_ADDRESS", BAddress usdstAddress)
  ] ++ concatMap (\BridgeChainInfo{..} ->
  [ (".chains[" <> BC.pack (show bci_chainId) <> "].chainName", BString $ encodeUtf8 bci_chainName)
  , (".chains[" <> BC.pack (show bci_chainId) <> "].custody", BAddress bci_custody)
  , (".chains[" <> BC.pack (show bci_chainId) <> "].depositRouter", BAddress bci_depositRouter)
  , (".chains[" <> BC.pack (show bci_chainId) <> "].enabled", BBool bci_enabled)
  , (".chains[" <> BC.pack (show bci_chainId) <> "].lastProcessedBlock", BInteger bci_lastProcessedBlock)
  ]) bcis ++ concatMap (\BridgeAssetInfo{..} ->
  [ (".assets[" <> addrBS bai_externalToken <> "][" <> BC.pack (show bai_externalChainId) <> "].enabled", BBool bai_enabled)
  , (".assets[" <> addrBS bai_externalToken <> "][" <> BC.pack (show bai_externalChainId) <> "].externalChainId", BInteger bai_externalChainId)
  , (".assets[" <> addrBS bai_externalToken <> "][" <> BC.pack (show bai_externalChainId) <> "].externalDecimals", BInteger bai_externalDecimals)
  , (".assets[" <> addrBS bai_externalToken <> "][" <> BC.pack (show bai_externalChainId) <> "].externalName", BString $ encodeUtf8 bai_externalName)
  , (".assets[" <> addrBS bai_externalToken <> "][" <> BC.pack (show bai_externalChainId) <> "].externalSymbol", BString $ encodeUtf8 bai_externalSymbol)
  , (".assets[" <> addrBS bai_externalToken <> "][" <> BC.pack (show bai_externalChainId) <> "].externalToken", BAddress bai_externalToken)
  , (".assets[" <> addrBS bai_externalToken <> "][" <> BC.pack (show bai_externalChainId) <> "].maxPerWithdrawal", BInteger bai_maxPerWithdrawal)
  , (".assets[" <> addrBS bai_externalToken <> "][" <> BC.pack (show bai_externalChainId) <> "].stratoToken", BAddress bai_stratoToken)
  ]) bais

poolFactory :: AddressInfo
poolFactory = SolidVMContractWithStorage poolFactoryAddress 0 proxy $ toPaths $ ownedByBlockApps mercataAddress ++
  [ (".tokenFactory", BAddress tokenFactoryAddress)
  , (".logicContract", BAddress poolFactoryImplAddress)
  , (".feeCollector", BAddress feeCollectorAddress)
  , (".swapFeeRate", BInteger 30)
  , (".lpSharePercent", BInteger 7000)
  ]

tokenFactory :: AddressInfo
tokenFactory = SolidVMContractWithStorage tokenFactoryAddress 0 proxy $ toPaths $ ownedByBlockApps mercataAddress
  ++ [ (".logicContract", BAddress tokenFactoryImplAddress)
     , (".isFactoryToken[" <> addrBS mTokenAddress <> "]", BBool True)
     , (".isFactoryToken[" <> addrBS sUsdstAddress <> "]", BBool True)
     , (".allTokens[0]", BAddress mTokenAddress)
     , (".allTokens[1]", BAddress sUsdstAddress)
     , (".allTokens.length", BInteger . fromIntegral $ 2 + length GA.assets)
     ]
  ++ ((\GA.Asset{..} -> (".isFactoryToken[" <> addrBS root <> "]", BBool True)) <$> GA.assets)
  ++ ((\(i, GA.Asset{..}) -> (".allTokens[" <> BC.pack (show i) <> "]", BAddress root)) <$> zip [(9 :: Integer)..] GA.assets)

adminRegistry :: [Address] -> Address -> [Address] -> AddressInfo
adminRegistry adminList bridgeRelayer oracleRelayers = SolidVMContractWithStorage adminRegistryAddress 0 proxy $ toPaths $ ownedByBlockApps mercataAddress
  ++ [ (".logicContract", BAddress adminRegistryImplAddress)
     , (".defaultVotingThresholdBps", BInteger 6000)
     , (".admins.length", BInteger . fromIntegral $ length adminList)
     , (".whitelist[" <> addrBS voucherAddress <> "][mint][" <> addrBS mercataBridgeAddress <> "]", BBool True)
     , (".whitelist[" <> addrBS voucherAddress <> "][mint][" <> addrBS bridgeRelayer <> "]", BBool True)
     , (".whitelist[" <> addrBS mercataBridgeAddress <> "][setLastProcessedBlock][" <> addrBS bridgeRelayer <> "]", BBool True)
     , (".whitelist[" <> addrBS mercataBridgeAddress <> "][deposit][" <> addrBS bridgeRelayer <> "]", BBool True)
     , (".whitelist[" <> addrBS mercataBridgeAddress <> "][depositBatch][" <> addrBS bridgeRelayer <> "]", BBool True)
     , (".whitelist[" <> addrBS mercataBridgeAddress <> "][confirmDeposit][" <> addrBS bridgeRelayer <> "]", BBool True)
     , (".whitelist[" <> addrBS mercataBridgeAddress <> "][confirmDepositBatch][" <> addrBS bridgeRelayer <> "]", BBool True)
     , (".whitelist[" <> addrBS mercataBridgeAddress <> "][reviewDeposit][" <> addrBS bridgeRelayer <> "]", BBool True)
     , (".whitelist[" <> addrBS mercataBridgeAddress <> "][reviewDepositBatch][" <> addrBS bridgeRelayer <> "]", BBool True)
     , (".whitelist[" <> addrBS mercataBridgeAddress <> "][confirmWithdrawal][" <> addrBS bridgeRelayer <> "]", BBool True)
     , (".whitelist[" <> addrBS mercataBridgeAddress <> "][confirmWithdrawalBatch][" <> addrBS bridgeRelayer <> "]", BBool True)
     , (".whitelist[" <> addrBS mercataBridgeAddress <> "][finaliseWithdrawal][" <> addrBS bridgeRelayer <> "]", BBool True)
     , (".whitelist[" <> addrBS mercataBridgeAddress <> "][finaliseWithdrawalBatch][" <> addrBS bridgeRelayer <> "]", BBool True)
     , (".whitelist[" <> addrBS mercataBridgeAddress <> "][abortWithdrawal][" <> addrBS bridgeRelayer <> "]", BBool True)
     , (".whitelist[" <> addrBS mercataBridgeAddress <> "][abortWithdrawalBatch][" <> addrBS bridgeRelayer <> "]", BBool True)
     , (".whitelist[" <> addrBS mTokenAddress <> "][mint][" <> addrBS liquidityPoolAddress <> "]", BBool True)
     , (".whitelist[" <> addrBS mTokenAddress <> "][burn][" <> addrBS liquidityPoolAddress <> "]", BBool True)
     , (".whitelist[" <> addrBS sUsdstAddress <> "][mint][" <> addrBS safetyModuleAddress <> "]", BBool True)
     , (".whitelist[" <> addrBS sUsdstAddress <> "][burn][" <> addrBS safetyModuleAddress <> "]", BBool True)
     , (".whitelist[" <> addrBS tokenFactoryAddress <> "][createTokenWithInitialOwner][" <> addrBS poolFactoryAddress <> "]", BBool True)
     , (".whitelist[" <> addrBS lendingRegistryAddress <> "][setLendingPool][" <> addrBS poolConfiguratorAddress <> "]", BBool True)
     , (".whitelist[" <> addrBS lendingRegistryAddress <> "][setLiquidityPool][" <> addrBS poolConfiguratorAddress <> "]", BBool True)
     , (".whitelist[" <> addrBS lendingRegistryAddress <> "][setCollateralVault][" <> addrBS poolConfiguratorAddress <> "]", BBool True)
     , (".whitelist[" <> addrBS lendingRegistryAddress <> "][setRateStrategy][" <> addrBS poolConfiguratorAddress <> "]", BBool True)
     , (".whitelist[" <> addrBS lendingRegistryAddress <> "][setPriceOracle][" <> addrBS poolConfiguratorAddress <> "]", BBool True)
     , (".whitelist[" <> addrBS lendingRegistryAddress <> "][setAllComponents][" <> addrBS poolConfiguratorAddress <> "]", BBool True)
     , (".whitelist[" <> addrBS cataAddress <> "][mint][" <> addrBS rewardsChefAddress <> "]", BBool True)
     ]
  ++ concatMap (\(i, adminAddress) ->
     [ (".admins[" <> BC.pack (show i) <> "]", BAddress adminAddress)
     , (".adminMap[" <> addrBS adminAddress <> "]", BInteger $ i + 1)
     ]) (zip [0..] adminList)
  ++ concatMap (\oracleRelayer ->
     [ (".whitelist[" <> addrBS priceOracleAddress <> "][setAssetPrice][" <> addrBS oracleRelayer <> "]", BBool True)
     , (".whitelist[" <> addrBS priceOracleAddress <> "][setAssetPrices][" <> addrBS oracleRelayer <> "]", BBool True)
     ]) oracleRelayers
  ++ concatMap (\GA.Asset{..} ->
      if name `elem` ["ETHST", "WBTCST", "PAXGST"]
         then [ (".whitelist[" <> addrBS root <> "][mint][" <> addrBS mercataBridgeAddress <> "]", BBool True)
              , (".whitelist[" <> addrBS root <> "][burn][" <> addrBS mercataBridgeAddress <> "]", BBool True)
              ]
         else if root == usdstAddress
                then [ (".whitelist[" <> addrBS root <> "][mint][" <> addrBS mercataBridgeAddress <> "]", BBool True)
                     , (".whitelist[" <> addrBS root <> "][burn][" <> addrBS mercataBridgeAddress <> "]", BBool True)
                     , (".whitelist[" <> addrBS root <> "][mint][" <> addrBS cdpEngineAddress <> "]", BBool True)
                     , (".whitelist[" <> addrBS root <> "][burn][" <> addrBS cdpEngineAddress <> "]", BBool True)
                     ]
                else []
     ) GA.assets

adminEvents :: (Address, S.Seq Event)
adminEvents = (\(a, evs) -> (a, (\(n,v) -> Event KECCAK256.zeroHash "BlockApps" "Mercata" "AdminRegistry" a n ((\(v1,v2) -> (v1,v2,"Other")) <$> v)) <$> evs)) (adminRegistryAddress, S.fromList $
    [("AdminAdded", [("admin", show blockappsAddress)])]
  )

feeCollector :: AddressInfo
feeCollector = SolidVMContractWithStorage feeCollectorAddress 0 proxy $ toPaths $ ownedByBlockApps mercataAddress
  ++ [(".logicContract", BAddress feeCollectorImplAddress)]

voucher :: [(Address, Integer)] -> AddressInfo
voucher extraAccounts = SolidVMContractWithStorage voucherAddress 0 proxy $ toPaths $ ownedByBlockApps mercataAddress
  ++ [ ("._name", BString "Voucher")
     , (".logicContract", BAddress voucherImplAddress)
     , ("._symbol", BString "VOUCHER")
     , ("._erc20Initialized", BBool True)
     , ("._totalSupply", BInteger $ 1_300_000 * oneE18)
     , ("._balances[" <> addrBS blockappsAddress <> "]", BInteger $ 1_000_000 * oneE18)
     ]
  ++ ((\(acct, bal) -> ("._balances[" <> addrBS acct <> "]", BInteger bal)) <$> extraAccounts)

mToken :: AddressInfo
mToken = SolidVMContractWithStorage mTokenAddress 0 proxy $ toPaths $ ownedByBlockApps mercataAddress
  ++ [ ("._name", BString "MUSDST")
     , (".logicContract", BAddress tokenImplAddress)
     , ("._symbol", BString "MUSDST")
     , ("._erc20Initialized", BBool True)
     , (".description", BString "MUSDST")
     , (".customDecimals", BInteger 18)
     , ("._totalSupply", BInteger 0)
     , (".tokenFactory", BContract "TokenFactory" tokenFactoryAddress)
     , (".status", BEnumVal "TokenStatus" "ACTIVE" 2)
     ]

rewardsChef :: AddressInfo
rewardsChef = SolidVMContractWithStorage rewardsChefAddress 0 proxy $ toPaths $ ownedByBlockApps mercataAddress
  ++ [ (".MAX_INT", BInteger 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff)
     , (".PRECISION_MULTIPLIER", BInteger oneE18)
     , (".rewardToken", BContract "Token" cataAddress)
     , (".logicContract", BAddress rewardsChefImplAddress)
     , (".cataPerSecond", BInteger 100000000000000)
     , (".totalAllocPoint", BInteger 200)
     , (".minFutureTime", BInteger 3600)
     -- lpTokenInUse mapping entries
     , (".lpTokenInUse[" <> addrBS mTokenAddress <> "]", BBool True)
     , (".lpTokenInUse[" <> addrBS sUsdstAddress <> "]", BBool True)
     -- mUSDST
     , (".pools[0].lpToken", BAddress mTokenAddress)
     , (".pools[0].allocPoint", BInteger 100)
     , (".pools[0].lastRewardTimestamp", BInteger lastAccrual)
     , (".pools[0].accPerToken", BInteger 0)
     , (".pools[0].bonusPeriods[0].startTimestamp", BInteger lastAccrual)
     , (".pools[0].bonusPeriods[0].bonusMultiplier", BInteger 1)
     , (".pools[0].bonusPeriods.length", BInteger 1)
     -- sUSDST
     , (".pools[1].lpToken", BAddress sUsdstAddress)
     , (".pools[1].allocPoint", BInteger 100)
     , (".pools[1].lastRewardTimestamp", BInteger lastAccrual)
     , (".pools[1].accPerToken", BInteger 0)
     , (".pools[1].bonusPeriods[0].startTimestamp", BInteger lastAccrual)
     , (".pools[1].bonusPeriods[0].bonusMultiplier", BInteger 1)
     , (".pools[1].bonusPeriods.length", BInteger 1)
     -- pools length
     , (".pools.length", BInteger 2)
     ]

cdpEngine :: AddressInfo
cdpEngine = SolidVMContractWithStorage cdpEngineAddress 0 proxy $ toPaths $ ownedByBlockApps mercataAddress
  ++ [ (".registry", BContract "CDPRegistry" cdpRegistryAddress)
     , (".logicContract", BAddress cdpEngineImplAddress)
     , (".globalPaused", BBool False)
     , (".RAY", BInteger ray)
     , (".WAD", BInteger oneE18)
     , (".collateralConfigs[" <> addrBS usdstAddress <> "].unitScale", BInteger oneE18)
     , (".collateralConfigs[" <> addrBS usdstAddress <> "].debtCeiling", BInteger $ 10_000_000 * oneE18)
     , (".collateralConfigs[" <> addrBS usdstAddress <> "].closeFactorBps", BInteger 5_000)
     , (".collateralConfigs[" <> addrBS usdstAddress <> "].liquidationRatio", BInteger $ 3 * oneE18 `div` 2)
     , (".collateralConfigs[" <> addrBS usdstAddress <> "].minCR", BInteger $ 31 * oneE18 `div` 20)
     , (".collateralConfigs[" <> addrBS usdstAddress <> "].stabilityFeeRate", BInteger $ ray + 627_937_192_293_877_252)
     , (".collateralConfigs[" <> addrBS usdstAddress <> "].liquidationPenaltyBps", BInteger 1_000)
     , (".collateralGlobalStates[" <> addrBS usdstAddress <> "].rateAccumulator", BInteger ray)
     , (".collateralGlobalStates[" <> addrBS usdstAddress <> "].lastAccrual", BInteger lastAccrual)
     , (".collateralGlobalStates[" <> addrBS usdstAddress <> "].totalScaledDebt", BInteger 0)
     , (".isSupportedAsset[" <> addrBS usdstAddress <> "]", BBool True)
     , (".feeToReserveBps", BInteger 0)
     , (".juniorPremiumBps", BInteger 0)
     , (".juniorIndex", BInteger ray)
     , (".totalJuniorOutstandingUSDST", BInteger 0)
     , (".prevReserveBalance", BInteger 0)
     ]
  ++ concatMap (\a ->
    [ (".collateralConfigs[" <> addrBS a <> "].debtFloor", BInteger oneE18)
    , (".collateralConfigs[" <> addrBS a <> "].unitScale", BInteger oneE18)
    , (".collateralConfigs[" <> addrBS a <> "].debtCeiling", BInteger $ 10_000_000 * oneE18)
    , (".collateralConfigs[" <> addrBS a <> "].closeFactorBps", BInteger 5_000)
    , (".collateralConfigs[" <> addrBS a <> "].liquidationRatio", BInteger $ 3 * oneE18 `div` 2)
    , (".collateralConfigs[" <> addrBS a <> "].minCR", BInteger $ 31 * oneE18 `div` 20)
    , (".collateralConfigs[" <> addrBS a <> "].stabilityFeeRate", BInteger $ ray + 627_937_192_293_877_252)
    , (".collateralConfigs[" <> addrBS a <> "].liquidationPenaltyBps", BInteger 1_000)
    , (".collateralGlobalStates[" <> addrBS a <> "].rateAccumulator", BInteger ray)
    , (".collateralGlobalStates[" <> addrBS a <> "].lastAccrual", BInteger lastAccrual)
    , (".collateralGlobalStates[" <> addrBS a <> "].totalScaledDebt", BInteger . sum . map GE.borrowedAmount $ filter ((== a) . GE.assetRootAddress) combinedEscrows)
    , (".isSupportedAsset[" <> addrBS a <> "]", BBool True)
    ]
  ) supportedCollaterals
  ++ concatMap (\GE.Escrow{..} ->
    [ (".vaults[" <> addrBS borrower <> "][" <> addrBS assetRootAddress <> "].scaledDebt", BInteger borrowedAmount)
    , (".vaults[" <> addrBS borrower <> "][" <> addrBS assetRootAddress <> "].collateral", BInteger collateralQuantity)
    ]) combinedEscrows

cdpEngineEvents :: (Address, S.Seq Event)
cdpEngineEvents = (\(a, evs) -> (a, (\(n,v) -> Event KECCAK256.zeroHash "BlockApps" "Mercata" "CDPEngine" a n ((\(v1,v2) -> (v1,v2,"Other")) <$> v)) <$> evs)) (cdpEngineAddress, S.fromList $
  map (\GE.Escrow{..} ->
    ("Deposited", [("user", show borrower), ("asset", show assetRootAddress), ("amount", show collateralQuantity)])
  ) combinedEscrows
  ++ map (\a ->
    ("CollateralConfigured",
      [ ("asset", show a)
      , ("liquidationRatio", show $ 3 * oneE18 `div` 2)
      , ("minCR", show $ 31 * oneE18 `div` 20)
      , ("liquidationPenaltyBps", "1000")
      , ("closeFactorBps", "5000")
      , ("stabilityFeeRate", show $ ray + oneE18 + 547_000_000_000_000_000)
      , ("debtFloor", show oneE18)
      , ("debtCeiling", show $ 10_000_000 * oneE18)
      , ("unitScale", show oneE18)
      , ("pause", show False)
      ]
    )
  ) supportedCollaterals
  )

cdpRegistry :: AddressInfo
cdpRegistry = SolidVMContractWithStorage cdpRegistryAddress 0 proxy $ toPaths $ ownedByBlockApps mercataAddress
  ++ [ (".cdpVault", BContract "CDPVault" cdpVaultAddress)
     , (".logicContract", BAddress cdpRegistryImplAddress)
     , (".cdpEngine", BContract "CDPEngine" cdpEngineAddress)
     , (".cdpReserve", BContract "CDPReserve" cdpReserveAddress)
     , (".priceOracle", BContract "PriceOracle" priceOracleAddress)
     , (".usdst", BContract "Token" usdstAddress)
     , (".tokenFactory", BContract "TokenFactory" tokenFactoryAddress)
     , (".feeCollector", BContract "FeeCollector" feeCollectorAddress)
     ]

cdpRegistryEvents :: (Address, S.Seq Event)
cdpRegistryEvents = (\(a, evs) -> (a, (\(n,v) -> Event KECCAK256.zeroHash "BlockApps" "Mercata" "CDPRegistry" a n ((\(v1,v2) -> (v1,v2,"Other")) <$> v)) <$> evs)) (cdpRegistryAddress, S.fromList $
  [ ("ComponentsUpdated",
      [ ("cdpVault", show cdpVaultAddress)
      , ("cdpEngine", show cdpEngineAddress)
      , ("priceOracle", show priceOracleAddress)
      , ("usdst", show usdstAddress)
      , ("tokenFactory", show tokenFactoryAddress)
      , ("feeCollector", show feeCollectorAddress)
      , ("cdpReserve", show cdpReserveAddress)
      ]
    )
  ])

cdpVault :: AddressInfo
cdpVault = SolidVMContractWithStorage cdpVaultAddress 0 proxy $ toPaths $ ownedByBlockApps mercataAddress
  ++ [ (".registry", BContract "CDPRegistry" cdpRegistryAddress)
     , (".logicContract", BAddress cdpVaultImplAddress)
     ]
  ++ concatMap (\GE.Escrow{..} ->
    [ (".userCollaterals[" <> addrBS borrower <> "][" <> addrBS assetRootAddress <> "]", BInteger collateralQuantity)
    ]) combinedEscrows

cdpVaultEvents :: (Address, S.Seq Event)
cdpVaultEvents = (\(a, evs) -> (a, (\(n,v) -> Event KECCAK256.zeroHash "BlockApps" "Mercata" "CDPVault" a n ((\(v1,v2) -> (v1,v2,"Other")) <$> v)) <$> evs)) (cdpVaultAddress, S.fromList $
  map (\GE.Escrow{..} ->
      ("CollateralDeposited", [("user", show borrower), ("asset", show assetRootAddress), ("amount", show collateralQuantity)])
  ) combinedEscrows
  ++ concatMap (\(bwr, amt) -> (if amt > 0
    then [("Borrowed", [("user", show bwr),("asset", show usdstAddress),("amount", show amt)])]
    else [])
  ) (M.toList $ foldr (\e -> M.insertWith (+) (GE.borrower e) (GE.borrowedAmount e)) M.empty combinedEscrows)
  )

cdpReserve :: AddressInfo
cdpReserve = SolidVMContractWithStorage cdpReserveAddress 0 proxy $ toPaths $ ownedByBlockApps mercataAddress
  ++ [ (".registry", BContract "CDPRegistry" cdpRegistryAddress)
     , (".logicContract", BAddress cdpReserveImplAddress)
     ]

safetyModule :: AddressInfo
safetyModule = SolidVMContractWithStorage safetyModuleAddress 0 proxy $ toPaths $ ownedByBlockApps mercataAddress
  ++ [ (".lendingRegistry", BContract "LendingRegistry" lendingRegistryAddress)
     , (".logicContract", BAddress safetyModuleImplAddress)
     , (".lendingPool", BContract "LendingPool" lendingPoolAddress)
     , (".liquidityPool", BContract "LiquidityPool" liquidityPoolAddress)
     , (".tokenFactory", BContract "TokenFactory" tokenFactoryAddress)
     , (".asset", BAddress usdstAddress)
     , (".sToken", BAddress sUsdstAddress)
     , (".COOLDOWN_SECONDS", BInteger 1)
     , (".UNSTAKE_WINDOW", BInteger 432000)
     , (".MAX_SLASH_BPS", BInteger 3000)
     , ("._managedAssets", BInteger 0)
     ]

safetyModuleEvents :: (Address, S.Seq Event)
safetyModuleEvents = (\(a, evs) -> (a, (\(n,v) -> Event KECCAK256.zeroHash "BlockApps" "Mercata" "SafetyModule" a n ((\(v1,v2) -> (v1,v2,"Other")) <$> v)) <$> evs)) (safetyModuleAddress, S.fromList $
  [ ("ParamsUpdated", [("cooldown", show (1 :: Integer)), ("window", show (432000 :: Integer)), ("maxSlashBps", show (3000 :: Integer))])
  , ("TokensUpdated", [("_asset", show usdstAddress), ("_sToken", show sUsdstAddress)])
  ])

sUsdst :: AddressInfo
sUsdst = SolidVMContractWithStorage sUsdstAddress 0 proxy $ toPaths $ ownedByBlockApps mercataAddress
  ++ [ ("._name", BString "sUSDST")
     , (".logicContract", BAddress tokenImplAddress)
     , ("._symbol", BString "SUSDST")
     , ("._erc20Initialized", BBool True)
     , (".description", BString "sUSDST")
     , (".customDecimals", BInteger 18)
     , ("._totalSupply", BInteger 0)
     , (".tokenFactory", BContract "TokenFactory" tokenFactoryAddress)
     , (".status", BEnumVal "TokenStatus" "ACTIVE" 2)
     ]

-- paxgstPool :: AddressInfo
-- paxgstPool = SolidVMContractWithStorage paxgstPoolAddress 0 proxy $ toPaths $ ownedByBlockApps mercataAddress
--   ++ [ (".poolFactory", BAddress poolFactoryAddress)
--      , (".tokenA", BContract "Token" paxgstRoot)
--      , (".tokenB", BContract "Token" usdstAddress)
--      , (".lpToken", BContract "Token" paxgstLpTokenAddress)
--      , (".locked", BBool False)
--      , (".aToBRatio", BDecimal "0.000299")
--      , (".bToARatio", BDecimal "3344.48160535")
--      , (".tokenABalance", BInteger $ (598 * oneE18) `div` 10)
--      , (".tokenBBalance", BInteger $ 200_000 * oneE18)
--      , (".swapFeeRate", BInteger 0)
--      , (".lpSharePercent", BInteger 0)
--      , (".zapSwapFeesEnabled", BBool True)
--      ]
--
-- paxgstLpToken :: AddressInfo
-- paxgstLpToken = SolidVMContractWithStorage paxgstLpTokenAddress 0 proxy $ toPaths $ ownedByBlockApps mercataAddress
--   ++ [ ("._name", BString "PAXGST-USDST LP Token")
--      , ("._symbol", BString "PAXGST-USDST-LP")
--      , (".description", BString "Liquidity Provider Token")
--      , (".customDecimals", BInteger 18)
--      , ("._totalSupply", BInteger $ 200_000 * oneE18)
--      , (".tokenFactory", BContract "TokenFactory" tokenFactoryAddress)
--      , (".status", BEnumVal "TokenStatus" "ACTIVE" 2)
--      , ("._balances[" <> addrBS blockappsAddress <> "]", BInteger $ 200_000 * oneE18)
--      ]

validators :: [Validator]
validators = [
  Validator 0x0c4cecae296c33f71f9a6e6fb57f418f9d5f7e82, --Node1
  Validator 0xbdd3fe1b9a87a88cff8259528c0a4d6464625713, --Node2
  Validator 0xebcd85c4212e53a2546cbcea765c1de531b14fb1, --Node3
  Validator 0xf1e4082464ff5c399e43f2c9177904db9547d6a2 --Node4
  ]

admins :: [Address]
admins = [blockappsAddress]

descriptions :: M.Map Text Text
descriptions = M.fromList
  [ ("PAXGST", "PAXGST is a digital asset on STRATO Mercata pegged 1:1 to PAX Gold (PAXG) on Ethereum, enabling holders to bridge their PAXG into Mercata, and access DeFi and staking opportunities."),
    ("WBTCST", "WBTCST mirrors Wrapped Bitcoin (WBTC) on Ethereum at a 1:1 ratio, allowing users to bridge WBTC to STRATO Mercata for use in staking and decentralized finance applications."),
    ("USDST", "USDST is a decentralized, collateral-backed stablecoin pegged to the US dollar and serves as the primary currency of the STRATO Mercata ecosystem, supporting instant marketplace purchases for stakeable assets."),
    ("SILVST", "SILVST provides fractional ownership of investment-grade silver backed by audited and insured physical silver; this combines traditional stability with digital efficiency. Each token represents one troy ounce of 99.9% pure silver, and can be redeemed for physical silver (fees apply)."),
    ("USDTST", "USDTST is a STRATO Mercata asset pegged 1:1 with Tether (USDT) on Ethereum, enabling seamless bridging and participation in Mercata’s DeFi and staking ecosystem."),
    ("MUSDST", "MUSDST is a STRATO Mercata native stablecoin (details TBD/temporary placeholder), designed to facilitate payments, DeFi activity, and ecosystem utility."),
    ("USDCST", "USDCST is pegged 1:1 to USD Coin (USDC) on Ethereum, allowing users to bridge USDC to STRATO Mercata and leverage its DeFi and staking functionality."),
    ("USDTEMP", "USDTEMP is a temporary STRATO Mercata token placeholder (details TBD) intended for bridging or testing functions within the ecosystem."),
    ("ETHST", "ETHST brings staked Ethereum into STRATO Mercata, giving users a flexible way to earn rewards while benefiting from integrated DeFi features."),
    ("GOLDST", "GOLDST provides fractional ownership of investment-grade gold backed by audited and insured physical gold; this combines traditional stability with digital efficiency. Each token represents one troy ounce of 99.5% pure gold (minimum), and can be redeemed for physical gold (fees apply).")
  ]
