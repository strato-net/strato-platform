{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE NumericUnderscores #-}
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
import           Blockchain.Strato.Model.Event
import qualified Blockchain.Strato.Model.Keccak256               as KECCAK256
import           Blockchain.Strato.Model.Validator
import           Blockchain.Stream.Action                        (Delegatecall(..))
import qualified Data.Aeson                                      as JSON
import qualified Data.ByteString                                 as B
import qualified Data.ByteString.Char8                           as BC
import qualified Data.ByteString.Lazy                            as BL
import           Data.List                                       (find)
import qualified Data.Map.Strict                                 as M
import           Data.Maybe                                      (fromMaybe, mapMaybe)
import qualified Data.Sequence                                   as S
import qualified Data.Set                                        as Set
import           Data.Text                                       (Text)
import qualified Data.Text                                       as T
import           Data.Text.Encoding
import           SolidVM.Model.Storable
import           Text.RawString.QQ

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

ethstPoolAddress :: Address
ethstPoolAddress = 0x1017

ethstLpTokenAddress :: Address
ethstLpTokenAddress = 0x1018

wbtcstPoolAddress :: Address
wbtcstPoolAddress = 0x1019

wbtcstLpTokenAddress :: Address
wbtcstLpTokenAddress = 0x101a

goldstPoolAddress :: Address
goldstPoolAddress = 0x101b

goldstLpTokenAddress :: Address
goldstLpTokenAddress = 0x101c

silvstPoolAddress :: Address
silvstPoolAddress = 0x101d

silvstLpTokenAddress :: Address
silvstLpTokenAddress = 0x101e

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

implContract :: Address -> String -> AccountInfo
implContract implAddress contractName =
  SolidVMContractWithStorage implAddress 0 (mercataContract contractName) $ ownedByBlockApps implAddress

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
              , (".:creatorAddress", BAccount $ unspecifiedChain blockappsAddress)
              , (".:originAddress", BAccount $ unspecifiedChain mercataAddress)
              , (".rateStrategy", BContract "RateStrategy" $ unspecifiedChain rateStrategyAddress)
              , (".priceOracle", BContract "PriceOracle" $ unspecifiedChain priceOracleAddress)
              , (".collateralVault", BContract "CollateralVault" $ unspecifiedChain collateralVaultAddress)
              , (".liquidityPool", BContract "LiquidityPool" $ unspecifiedChain liquidityPoolAddress)
              , (".lendingPool", BContract "LendingPool" $ unspecifiedChain lendingPoolAddress)
              , (".poolConfigurator", BContract "PoolConfigurator" $ unspecifiedChain poolConfiguratorAddress)
              , (".lendingRegistry", BContract "LendingRegistry" $ unspecifiedChain lendingRegistryAddress)
              , (".mercataBridge", BContract "MercataBridge" $ unspecifiedChain mercataBridgeAddress)
              , (".poolFactory", BContract "PoolFactory" $ unspecifiedChain poolFactoryAddress)
              , (".tokenFactory", BContract "TokenFactory" $ unspecifiedChain tokenFactoryAddress)
              , (".feeCollector", BContract "FeeCollector" $ unspecifiedChain feeCollectorAddress)
              , (".adminRegistry", BContract "AdminRegistry" $ unspecifiedChain adminRegistryAddress)
              , (".rewardsChef", BContract "RewardsChef" $ unspecifiedChain rewardsChefAddress)
              , (".cdpEngine", BContract "CDPEngine" $ unspecifiedChain cdpEngineAddress)
              , (".cdpRegistry", BContract "CDPRegistry" $ unspecifiedChain cdpRegistryAddress)
              , (".cdpVault", BContract "CDPVault" $ unspecifiedChain cdpVaultAddress)
              , (".cdpReserve", BContract "CDPReserve" $ unspecifiedChain cdpReserveAddress)
              , (".safetyModule", BContract "SafetyModule" $ unspecifiedChain safetyModuleAddress)
              ]
            ] ++ mapMaybe assetToAccountInfos GA.assets ++
            [ rateStrategy
            , priceOracle
            , collateralVault
            , liquidityPool
            , lendingPool
            , poolConfigurator
            , lendingRegistry
            , mercataBridge
            , poolFactory
            , tokenFactory
            , adminRegistry
            , feeCollector
            , voucher
            , mToken
            , rewardsChef
            , cdpEngine
            , cdpRegistry
            , cdpVault
            , cdpReserve
            , safetyModule
            , sUsdst
            , ethstPool
            , ethstLpToken
            , wbtcstPool
            , wbtcstLpToken
            , goldstPool
            , goldstLpToken
            , silvstPool
            , silvstLpToken
            -- , paxgstPool
            -- , paxgstLpToken
            ],
        genesisInfoCodeInfo=[CodeInfo (decodeUtf8 $ BL.toStrict $ JSON.encode mercataContracts) (Just "Mercata")],
        genesisInfoEvents = M.fromList $
          (assetToEvents <$> GA.assets)
          ++ [ adminEvents
             , lendingPoolEvents
             , poolConfiguratorEvents
             , cdpEngineEvents
             , cdpRegistryEvents
             , cdpVaultEvents
             , safetyModuleEvents
             ],
        genesisInfoDelegatecalls = M.fromList . map (fmap S.singleton) $
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
             , (ethstPoolAddress, Delegatecall ethstPoolAddress poolImplAddress "BlockApps" "Mercata" "Pool")
             , (ethstLpTokenAddress, Delegatecall ethstLpTokenAddress tokenImplAddress "BlockApps" "Mercata" "Token")
             , (wbtcstPoolAddress, Delegatecall wbtcstPoolAddress poolImplAddress "BlockApps" "Mercata" "Pool")
             , (wbtcstLpTokenAddress, Delegatecall wbtcstLpTokenAddress tokenImplAddress "BlockApps" "Mercata" "Token")
             , (goldstPoolAddress, Delegatecall goldstPoolAddress poolImplAddress "BlockApps" "Mercata" "Pool")
             , (goldstLpTokenAddress, Delegatecall goldstLpTokenAddress tokenImplAddress "BlockApps" "Mercata" "Token")
             , (silvstPoolAddress, Delegatecall silvstPoolAddress poolImplAddress "BlockApps" "Mercata" "Pool")
             , (silvstLpTokenAddress, Delegatecall silvstLpTokenAddress tokenImplAddress "BlockApps" "Mercata" "Token")
             ]
        }

createdByBlockApps :: Address -> [(B.ByteString, BasicValue)]
createdByBlockApps originAddress =
  [ (".:creator", BString $ encodeUtf8 "BlockApps")
  , (".:creatorAddress", BAccount $ unspecifiedChain blockappsAddress)
  , (".:originAddress", BAccount $ unspecifiedChain originAddress)
  ]

ownedByBlockApps :: Address -> [(B.ByteString, BasicValue)]
ownedByBlockApps originAddress = ("._owner", BAccount $ unspecifiedChain adminRegistryAddress) : createdByBlockApps originAddress

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
lastAccrual = 1759204800 -- September 30th, 2025, 12:00:00 AM

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
    . (++) (case () of
              _ | root == ethstRoot -> [(blockappsAddress, 1_000_000 * oneE18), (ethstPoolAddress, 11_129_288_949_700_000_000)]
                | root == wbtcstRoot -> [(blockappsAddress, 1_000_000 * oneE18), (wbtcstPoolAddress, (425 * oneE18) `div` 1000)]
                | root == goldstRoot -> [(blockappsAddress, 1_000_000 * oneE18), (goldstPoolAddress, (151 * oneE18) `div` 10)]
                | root == silvstRoot -> [(blockappsAddress, 1_000_000 * oneE18), (silvstPoolAddress, (13_125 * oneE18) `div` 10)]
                -- | root == paxgstRoot -> [(paxgstPoolAddress, (598 * oneE18) `div` 10)]
                | otherwise -> []
           )
    . concatMap (\case
      (GA.Balance _ o c q)
        | root == usdstAddress &&  c == "mercata_usdst" ->
            [ (blockappsAddress, 1_000_000 * oneE18) -- correctQuantity decimals name q)
            , (bridgeRelayerAddress, 1_000 * oneE18)
            , (oracleAddress1, 1_000 * oneE18)
            , (oracleAddress2, 1_000 * oneE18)
            , (ethstPoolAddress, 50_000 * oneE18)
            , (wbtcstPoolAddress, 50_000 * oneE18)
            , (goldstPoolAddress, 50_000 * oneE18)
            , (silvstPoolAddress, 50_000 * oneE18)
            -- , (paxgstPoolAddress, 200_000 * oneE18)
            , (liquidityPoolAddress, 250_000 * oneE18)
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

assetToAccountInfos :: GA.Asset -> Maybe AccountInfo
assetToAccountInfos asset@GA.Asset{..} =
  let accountBalances' = assetBalances asset
      allBalances = (\(a, b) -> ("._balances<a:" <> addrBS a <> ">", BInteger b)) <$> accountBalances'
      takeCaps = T.pack . filter (\c -> (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) . T.unpack
      name' = if root == silvstRoot then "SILVST" else name
      description' = fromMaybe description $ M.lookup name' descriptions
   in case allBalances of
        [] -> Nothing
        _ -> Just . SolidVMContractWithStorage root 0 proxy $
          ownedByBlockApps root ++
          [ (".logicContract", BAccount $ unspecifiedChain tokenImplAddress)
          , ("._name", BString $ encodeUtf8 name')
          , ("._symbol", if root == silvstRoot then BString "SILVST" else BString $ encodeUtf8 $ takeCaps name)
          , (".description", BString $ encodeUtf8 description')
          , (".customDecimals", BInteger 18)
          , ("._totalSupply", BInteger . sum $ (\(_, v) -> case v of BInteger i -> i; _ -> 0) <$> allBalances)
          , (".tokenFactory", BContract "TokenFactory" $ unspecifiedChain tokenFactoryAddress)
          , (".images.length", BInteger . fromIntegral $ length images)
          , (".files.length", BInteger . fromIntegral $ length files)
          , (".fileNames.length", BInteger . fromIntegral $ length fileNames)
          ] ++ map (\(k,v) -> (".images[" <> encodeUtf8 (T.pack $ show k) <> "]", BString $ encodeUtf8 v)) (M.toList images)
            ++ map (\(k,v) -> (".files[" <> encodeUtf8 (T.pack $ show k) <> "]", BString $ encodeUtf8 v)) (M.toList files)
            ++ map (\(k,v) -> (".fileNames[" <> encodeUtf8 (T.pack $ show k) <> "]", BString $ encodeUtf8 v)) (M.toList fileNames)
            ++ map (\(k,v) -> (".attributes<" <> encodeUtf8 (T.pack $ show k) <> ">", BString $ encodeUtf8 v)) (M.toList assetData)
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
rateStrategy :: AccountInfo
rateStrategy = SolidVMContractWithStorage rateStrategyAddress 0 proxy $ createdByBlockApps mercataAddress
  ++ [(".logicContract", BAccount $ unspecifiedChain rateStrategyImplAddress)]

priceOracle :: AccountInfo
priceOracle = SolidVMContractWithStorage priceOracleAddress 0 proxy $
  (".logicContract", BAccount $ unspecifiedChain priceOracleImplAddress)
  : (".prices<a:" <> addrBS usdstAddress <> ">", BInteger oneE18)
  : (".authorizedOracles<a:" <> addrBS usdstAddress <> ">", BBool True)
  : ownedByBlockApps mercataAddress
  ++ mapMaybe (\GR.Reserve{..} -> flip fmap (M.lookup assetRootAddress assetMap) $ \a ->
    (".prices<a:" <> addrBS assetRootAddress <> ">", BInteger . round $ lastUpdatedOraclePrice * (10.0 ** (fromInteger $ 18 + getDecimals (GA.decimals a) (GA.name a))))
  ) GR.reserves

collateralVault :: AccountInfo
collateralVault = SolidVMContractWithStorage collateralVaultAddress 0 proxy $ ownedByBlockApps mercataAddress ++
  [ (".registry", BContract "LendingRegistry" $ unspecifiedChain lendingRegistryAddress)
  , (".logicContract", BAccount $ unspecifiedChain collateralVaultImplAddress)
  ]

liquidityPool :: AccountInfo
liquidityPool = SolidVMContractWithStorage liquidityPoolAddress 0 proxy $ ownedByBlockApps mercataAddress ++
  [ (".registry", BContract "LendingRegistry" $ unspecifiedChain lendingRegistryAddress)
  , (".logicContract", BAccount $ unspecifiedChain liquidityPoolImplAddress)
  , (".mToken", BContract "Token" $ unspecifiedChain mTokenAddress)
  ]

lendingPool :: AccountInfo
lendingPool = SolidVMContractWithStorage lendingPoolAddress 0 proxy $ ownedByBlockApps mercataAddress ++
  [ (".registry", BContract "LendingRegistry" $ unspecifiedChain lendingRegistryAddress)
  , (".logicContract", BAccount $ unspecifiedChain lendingPoolImplAddress)
  , (".poolConfigurator", BAccount $ unspecifiedChain poolConfiguratorAddress)
  , (".tokenFactory", BContract "TokenFactory" $ unspecifiedChain tokenFactoryAddress)
  , (".feeCollector", BContract "FeeCollector" $ unspecifiedChain feeCollectorAddress)
  , (".safetyModule", BContract "SafetyModule" $ unspecifiedChain safetyModuleAddress)
  , (".borrowableAsset", BAccount $ unspecifiedChain usdstAddress)
  , (".mToken", BAccount $ unspecifiedChain mTokenAddress)
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
  [ (".assetConfigs<a:" <> addrBS usdstAddress <> ">.ltv", BInteger 7500)
  , (".assetConfigs<a:" <> addrBS usdstAddress <> ">.interestRate", BInteger 500)
  , (".assetConfigs<a:" <> addrBS usdstAddress <> ">.reserveFactor", BInteger 1000)
  , (".assetConfigs<a:" <> addrBS usdstAddress <> ">.liquidationBonus", BInteger 10500)
  , (".assetConfigs<a:" <> addrBS usdstAddress <> ">.liquidationThreshold", BInteger 8000)
  , (".assetConfigs<a:" <> addrBS usdstAddress <> ">.perSecondFactorRAY", BInteger $ ray + 1_547_125_956_666_413_085)
  , (".configuredAssets[0]", BAccount $ unspecifiedChain usdstAddress)
  , (".configuredAssets.length", BInteger . fromIntegral $ 1 + length supportedCollaterals)
  ] ++ concatMap (\(i, a) ->
  [ (".assetConfigs<a:" <> addrBS a <> ">.ltv", BInteger 7500)
  , (".assetConfigs<a:" <> addrBS a <> ">.interestRate", BInteger 500)
  , (".assetConfigs<a:" <> addrBS a <> ">.reserveFactor", BInteger 1000)
  , (".assetConfigs<a:" <> addrBS a <> ">.liquidationBonus", BInteger 10500)
  , (".assetConfigs<a:" <> addrBS a <> ">.liquidationThreshold", BInteger 8000)
  , (".assetConfigs<a:" <> addrBS a <> ">.perSecondFactorRAY", BInteger $ ray + 1_547_125_956_666_413_085)
  , (".configuredAssets[" <> BC.pack (show i) <> "]", BAccount $ unspecifiedChain a)
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

poolConfigurator :: AccountInfo
poolConfigurator = SolidVMContractWithStorage poolConfiguratorAddress 0 proxy $ ownedByBlockApps mercataAddress ++
  [ (".registry", BContract "LendingRegistry" $ unspecifiedChain lendingRegistryAddress)
  , (".logicContract", BAccount $ unspecifiedChain poolConfiguratorImplAddress)
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

lendingRegistry :: AccountInfo
lendingRegistry = SolidVMContractWithStorage lendingRegistryAddress 0 proxy $ ownedByBlockApps mercataAddress ++
  [ (".lendingPool", BContract "LendingPool" $ unspecifiedChain lendingPoolAddress)
  , (".logicContract", BAccount $ unspecifiedChain lendingRegistryImplAddress)
  , (".liquidityPool", BContract "LiquidityPool" $ unspecifiedChain liquidityPoolAddress)
  , (".collateralVault", BContract "CollateralVault" $ unspecifiedChain collateralVaultAddress)
  , (".rateStrategy", BContract "RateStrategy" $ unspecifiedChain rateStrategyAddress)
  , (".priceOracle", BContract "PriceOracle" $ unspecifiedChain priceOracleAddress)
  ]

mercataBridge :: AccountInfo
mercataBridge = SolidVMContractWithStorage mercataBridgeAddress 0 proxy $ ownedByBlockApps mercataAddress ++
  [ (".relayer", BAccount $ unspecifiedChain bridgeRelayerAddress)
  , (".logicContract", BAccount $ unspecifiedChain mercataBridgeImplAddress)
  , (".tokenFactory", BContract "TokenFactory" $ unspecifiedChain tokenFactoryAddress)
  , (".depositsPaused", BBool False)
  , (".withdrawalCounter", BInteger 0)
  , (".withdrawalsPaused", BBool False)
  , (".WITHDRAWAL_ABORT_DELAY", BInteger 172800)
  , (".PERMISSION_WRAP", BInteger 1)
  , (".PERMISSION_MINT", BInteger 2)
  , (".PERMISSION_MASK", BInteger 3)
  , (".USDST_ADDRESS", BAccount $ unspecifiedChain usdstAddress)
  , (".chains<11155111>.custody", BAccount $ unspecifiedChain 0x8713850e9ff0fd0200ce87c32e3cdb24ed021631)
  , (".chains<11155111>.depositRouter", BAccount $ unspecifiedChain 0x8223f1a6a4710c110a3c4333b7682de23cd072a5)
  , (".chains<11155111>.lastProcessedBlock", BInteger 9217425)
  , (".chains<11155111>.enabled", BBool True)
  , (".chains<11155111>.chainName", BString "Ethereum Sepolia")
  -- , (".assets<a:93fb7295859b2d70199e0a4883b7c320cf874e6c><11155111>.externalToken", BAccount $ unspecifiedChain 0x0000000000000000000000000000000000000000)
  -- , (".assets<a:93fb7295859b2d70199e0a4883b7c320cf874e6c><11155111>.externalDecimals", BInteger 18)
  -- , (".assets<a:93fb7295859b2d70199e0a4883b7c320cf874e6c><11155111>.externalChainId", BInteger 11155111)
  -- , (".assets<a:93fb7295859b2d70199e0a4883b7c320cf874e6c><11155111>.externalName", BString "Ether")
  -- , (".assets<a:93fb7295859b2d70199e0a4883b7c320cf874e6c><11155111>.externalSymbol", BString "ETH")
  -- , (".assets<a:93fb7295859b2d70199e0a4883b7c320cf874e6c><11155111>.maxPerTx", BInteger 0)
  -- , (".assets<a:93fb7295859b2d70199e0a4883b7c320cf874e6c><11155111>.permissions", BInteger 1)
  , (".assets<a:93fb7295859b2d70199e0a4883b7c320cf874e6c><11155111>.externalToken", BAccount $ unspecifiedChain 0xe46550c8d3c4e5a04da14a948543d918d69f3df1)
  , (".assets<a:93fb7295859b2d70199e0a4883b7c320cf874e6c><11155111>.externalDecimals", BInteger 18)
  , (".assets<a:93fb7295859b2d70199e0a4883b7c320cf874e6c><11155111>.externalChainId", BInteger 11155111)
  , (".assets<a:93fb7295859b2d70199e0a4883b7c320cf874e6c><11155111>.externalName", BString "METH")
  , (".assets<a:93fb7295859b2d70199e0a4883b7c320cf874e6c><11155111>.externalSymbol", BString "METH")
  , (".assets<a:93fb7295859b2d70199e0a4883b7c320cf874e6c><11155111>.maxPerTx", BInteger 0)
  , (".assets<a:93fb7295859b2d70199e0a4883b7c320cf874e6c><11155111>.permissions", BInteger 1)
  -- , (".assets<a:7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9><11155111>.externalToken", BAccount $ unspecifiedChain 0x29f2d40b0605204364af54ec677bd022da425d03)
  -- , (".assets<a:7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9><11155111>.externalDecimals", BInteger 8)
  -- , (".assets<a:7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9><11155111>.externalChainId", BInteger 11155111)
  -- , (".assets<a:7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9><11155111>.externalName", BString "WBTC")
  -- , (".assets<a:7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9><11155111>.externalSymbol", BString "WBTC")
  -- , (".assets<a:7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9><11155111>.maxPerTx", BInteger 0)
  -- , (".assets<a:7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9><11155111>.permissions", BInteger 1)
  -- , (".assets<a:491cdfe98470bfe69b662ab368826dca0fc2f24d><11155111>.externalToken", BAccount $ unspecifiedChain 0x8599ea38e03e9d0a8b9e86a47ac119fc78d6b6d3)
  -- , (".assets<a:491cdfe98470bfe69b662ab368826dca0fc2f24d><11155111>.externalDecimals", BInteger 18)
  -- , (".assets<a:491cdfe98470bfe69b662ab368826dca0fc2f24d><11155111>.externalChainId", BInteger 11155111)
  -- , (".assets<a:491cdfe98470bfe69b662ab368826dca0fc2f24d><11155111>.externalName", BString "PAXG")
  -- , (".assets<a:491cdfe98470bfe69b662ab368826dca0fc2f24d><11155111>.externalSymbol", BString "PAXG")
  -- , (".assets<a:491cdfe98470bfe69b662ab368826dca0fc2f24d><11155111>.maxPerTx", BInteger 0)
  -- , (".assets<a:491cdfe98470bfe69b662ab368826dca0fc2f24d><11155111>.permissions", BInteger 1)
  -- , (".assets<a:3d351a4a339f6eef7371b0b1b025b3a434ad0399><11155111>.externalToken", BAccount $ unspecifiedChain 0x1c7d4b196cb0c7b01d743fbc6116a902379c7238)
  -- , (".assets<a:3d351a4a339f6eef7371b0b1b025b3a434ad0399><11155111>.externalDecimals", BInteger 6)
  -- , (".assets<a:3d351a4a339f6eef7371b0b1b025b3a434ad0399><11155111>.externalChainId", BInteger 11155111)
  -- , (".assets<a:3d351a4a339f6eef7371b0b1b025b3a434ad0399><11155111>.externalName", BString "USDC")
  -- , (".assets<a:3d351a4a339f6eef7371b0b1b025b3a434ad0399><11155111>.externalSymbol", BString "USDC")
  -- , (".assets<a:3d351a4a339f6eef7371b0b1b025b3a434ad0399><11155111>.maxPerTx", BInteger 0)
  -- , (".assets<a:3d351a4a339f6eef7371b0b1b025b3a434ad0399><11155111>.permissions", BInteger 2)
  , (".assets<a:3d351a4a339f6eef7371b0b1b025b3a434ad0399><11155111>.externalToken", BAccount $ unspecifiedChain 0x46e96acf148b019da71e41f36239833f550dfeb9)
  , (".assets<a:3d351a4a339f6eef7371b0b1b025b3a434ad0399><11155111>.externalDecimals", BInteger 6)
  , (".assets<a:3d351a4a339f6eef7371b0b1b025b3a434ad0399><11155111>.externalChainId", BInteger 11155111)
  , (".assets<a:3d351a4a339f6eef7371b0b1b025b3a434ad0399><11155111>.externalName", BString "MUSDC")
  , (".assets<a:3d351a4a339f6eef7371b0b1b025b3a434ad0399><11155111>.externalSymbol", BString "MUSDC")
  , (".assets<a:3d351a4a339f6eef7371b0b1b025b3a434ad0399><11155111>.maxPerTx", BInteger 0)
  , (".assets<a:3d351a4a339f6eef7371b0b1b025b3a434ad0399><11155111>.permissions", BInteger 2)
  -- , (".assets<a:86a5ae535ded415203c3e27d654f9a1d454c553b><11155111>.externalToken", BAccount $ unspecifiedChain 0xaa8e23fb1079ea71e0a56f48a2aa51851d8433d0)
  -- , (".assets<a:86a5ae535ded415203c3e27d654f9a1d454c553b><11155111>.externalDecimals", BInteger 6)
  -- , (".assets<a:86a5ae535ded415203c3e27d654f9a1d454c553b><11155111>.externalChainId", BInteger 11155111)
  -- , (".assets<a:86a5ae535ded415203c3e27d654f9a1d454c553b><11155111>.externalName", BString "USDT")
  -- , (".assets<a:86a5ae535ded415203c3e27d654f9a1d454c553b><11155111>.externalSymbol", BString "USDT")
  -- , (".assets<a:86a5ae535ded415203c3e27d654f9a1d454c553b><11155111>.maxPerTx", BInteger 0)
  -- , (".assets<a:86a5ae535ded415203c3e27d654f9a1d454c553b><11155111>.permissions", BInteger 2)
  ]

poolFactory :: AccountInfo
poolFactory = SolidVMContractWithStorage poolFactoryAddress 0 proxy $ ownedByBlockApps mercataAddress ++
  [ (".tokenFactory", BAccount $ unspecifiedChain tokenFactoryAddress)
  , (".logicContract", BAccount $ unspecifiedChain poolFactoryImplAddress)
  , (".feeCollector", BAccount $ unspecifiedChain feeCollectorAddress)
  , (".swapFeeRate", BInteger 30)
  , (".lpSharePercent", BInteger 7000)
  ]

tokenFactory :: AccountInfo
tokenFactory = SolidVMContractWithStorage tokenFactoryAddress 0 proxy $ ownedByBlockApps mercataAddress
  ++ [ (".logicContract", BAccount $ unspecifiedChain tokenFactoryImplAddress)
     , (".isFactoryToken<a:" <> addrBS mTokenAddress <> ">", BBool True)
     , (".isFactoryToken<a:" <> addrBS sUsdstAddress <> ">", BBool True)
     , (".isFactoryToken<a:" <> addrBS ethstLpTokenAddress <> ">", BBool True)
     , (".isFactoryToken<a:" <> addrBS wbtcstLpTokenAddress <> ">", BBool True)
     , (".isFactoryToken<a:" <> addrBS goldstLpTokenAddress <> ">", BBool True)
     , (".isFactoryToken<a:" <> addrBS silvstLpTokenAddress <> ">", BBool True)
     -- , (".isFactoryToken<a:" <> addrBS paxgstLpTokenAddress <> ">", BBool True)
     , (".allTokens[0]", BAccount $ unspecifiedChain mTokenAddress)
     , (".allTokens[1]", BAccount $ unspecifiedChain sUsdstAddress)
     , (".allTokens[2]", BAccount $ unspecifiedChain ethstLpTokenAddress)
     , (".allTokens[3]", BAccount $ unspecifiedChain wbtcstLpTokenAddress)
     , (".allTokens[4]", BAccount $ unspecifiedChain goldstLpTokenAddress)
     , (".allTokens[5]", BAccount $ unspecifiedChain silvstLpTokenAddress)
     -- , (".allTokens[8]", BAccount $ unspecifiedChain paxgstLpTokenAddress)
     , (".allTokens.length", BInteger . fromIntegral $ 6 + length GA.assets)
     ]
  ++ ((\GA.Asset{..} -> (".isFactoryToken<a:" <> addrBS root <> ">", BBool True)) <$> GA.assets)
  ++ ((\(i, GA.Asset{..}) -> (".allTokens[" <> BC.pack (show i) <> "]", BAccount $ unspecifiedChain root)) <$> zip [(9 :: Integer)..] GA.assets)

adminRegistry :: AccountInfo
adminRegistry = SolidVMContractWithStorage adminRegistryAddress 0 proxy $ createdByBlockApps mercataAddress
  ++ [ (".adminMap<a:" <> addrBS blockappsAddress <> ">", BInteger 1)
     , (".logicContract", BAccount $ unspecifiedChain adminRegistryImplAddress)
     , (".admins[0]", BAccount $ unspecifiedChain blockappsAddress)
     , (".admins.length", BInteger 1)
     , (".whitelist<a:" <> addrBS voucherAddress <> "><\"mint\"><a:" <> addrBS mercataBridgeAddress <> ">", BBool True)
     , (".whitelist<a:" <> addrBS voucherAddress <> "><\"mint\"><a:" <> addrBS bridgeRelayerAddress <> ">", BBool True)
     , (".whitelist<a:" <> addrBS mTokenAddress <> "><\"mint\"><a:" <> addrBS liquidityPoolAddress <> ">", BBool True)
     , (".whitelist<a:" <> addrBS mTokenAddress <> "><\"burn\"><a:" <> addrBS liquidityPoolAddress <> ">", BBool True)
     , (".whitelist<a:" <> addrBS sUsdstAddress <> "><\"mint\"><a:" <> addrBS safetyModuleAddress <> ">", BBool True)
     , (".whitelist<a:" <> addrBS sUsdstAddress <> "><\"burn\"><a:" <> addrBS safetyModuleAddress <> ">", BBool True)
     , (".whitelist<a:" <> addrBS ethstLpTokenAddress <> "><\"mint\"><a:" <> addrBS ethstPoolAddress <> ">", BBool True)
     , (".whitelist<a:" <> addrBS ethstLpTokenAddress <> "><\"burn\"><a:" <> addrBS ethstPoolAddress <> ">", BBool True)
     , (".whitelist<a:" <> addrBS wbtcstLpTokenAddress <> "><\"mint\"><a:" <> addrBS wbtcstPoolAddress <> ">", BBool True)
     , (".whitelist<a:" <> addrBS wbtcstLpTokenAddress <> "><\"burn\"><a:" <> addrBS wbtcstPoolAddress <> ">", BBool True)
     , (".whitelist<a:" <> addrBS goldstLpTokenAddress <> "><\"mint\"><a:" <> addrBS goldstPoolAddress <> ">", BBool True)
     , (".whitelist<a:" <> addrBS goldstLpTokenAddress <> "><\"burn\"><a:" <> addrBS goldstPoolAddress <> ">", BBool True)
     , (".whitelist<a:" <> addrBS silvstLpTokenAddress <> "><\"mint\"><a:" <> addrBS silvstPoolAddress <> ">", BBool True)
     , (".whitelist<a:" <> addrBS silvstLpTokenAddress <> "><\"burn\"><a:" <> addrBS silvstPoolAddress <> ">", BBool True)
     -- , (".whitelist<a:" <> addrBS paxgstLpTokenAddress <> "><\"mint\"><a:" <> addrBS paxgstPoolAddress <> ">", BBool True)
     -- , (".whitelist<a:" <> addrBS paxgstLpTokenAddress <> "><\"burn\"><a:" <> addrBS paxgstPoolAddress <> ">", BBool True)
     , (".whitelist<a:" <> addrBS tokenFactoryAddress <> "><\"createTokenWithInitialOwner\"><a:" <> addrBS poolFactoryAddress <> ">", BBool True)
     , (".whitelist<a:" <> addrBS priceOracleAddress <> "><\"setAssetPrice\"><a:" <> addrBS oracleAddress1 <> ">", BBool True)
     , (".whitelist<a:" <> addrBS priceOracleAddress <> "><\"setAssetPrices\"><a:" <> addrBS oracleAddress1 <> ">", BBool True)
     , (".whitelist<a:" <> addrBS priceOracleAddress <> "><\"setAssetPrice\"><a:" <> addrBS oracleAddress2 <> ">", BBool True)
     , (".whitelist<a:" <> addrBS priceOracleAddress <> "><\"setAssetPrices\"><a:" <> addrBS oracleAddress2 <> ">", BBool True)
     , (".whitelist<a:" <> addrBS lendingRegistryAddress <> "><\"setLendingPool\"><a:" <> addrBS poolConfiguratorAddress <> ">", BBool True)
     , (".whitelist<a:" <> addrBS lendingRegistryAddress <> "><\"setLiquidityPool\"><a:" <> addrBS poolConfiguratorAddress <> ">", BBool True)
     , (".whitelist<a:" <> addrBS lendingRegistryAddress <> "><\"setCollateralVault\"><a:" <> addrBS poolConfiguratorAddress <> ">", BBool True)
     , (".whitelist<a:" <> addrBS lendingRegistryAddress <> "><\"setRateStrategy\"><a:" <> addrBS poolConfiguratorAddress <> ">", BBool True)
     , (".whitelist<a:" <> addrBS lendingRegistryAddress <> "><\"setPriceOracle\"><a:" <> addrBS poolConfiguratorAddress <> ">", BBool True)
     , (".whitelist<a:" <> addrBS lendingRegistryAddress <> "><\"setAllComponents\"><a:" <> addrBS poolConfiguratorAddress <> ">", BBool True)
     , (".whitelist<a:" <> addrBS cataAddress <> "><\"mint\"><a:" <> addrBS rewardsChefAddress <> ">", BBool True)
     ]
  ++ concatMap (\GA.Asset{..} ->
      if name `elem` ["ETHST", "WBTCST", "PAXGST"]
         then [ (".whitelist<a:" <> addrBS root <> "><\"mint\"><a:" <> addrBS mercataBridgeAddress <> ">", BBool True)
              , (".whitelist<a:" <> addrBS root <> "><\"burn\"><a:" <> addrBS mercataBridgeAddress <> ">", BBool True)
              ]
         else if root == usdstAddress
                then [ (".whitelist<a:" <> addrBS root <> "><\"mint\"><a:" <> addrBS mercataBridgeAddress <> ">", BBool True)
                     , (".whitelist<a:" <> addrBS root <> "><\"burn\"><a:" <> addrBS mercataBridgeAddress <> ">", BBool True)
                     , (".whitelist<a:" <> addrBS root <> "><\"mint\"><a:" <> addrBS cdpEngineAddress <> ">", BBool True)
                     , (".whitelist<a:" <> addrBS root <> "><\"burn\"><a:" <> addrBS cdpEngineAddress <> ">", BBool True)
                     ]
                else []
     ) GA.assets

adminEvents :: (Address, S.Seq Event)
adminEvents = (\(a, evs) -> (a, (\(n,v) -> Event KECCAK256.zeroHash "BlockApps" "Mercata" "AdminRegistry" a n ((\(v1,v2) -> (v1,v2,"Other")) <$> v)) <$> evs)) (adminRegistryAddress, S.fromList $
    [("AdminAdded", [("admin", show blockappsAddress)])]
  )

feeCollector :: AccountInfo
feeCollector = SolidVMContractWithStorage feeCollectorAddress 0 proxy $ ownedByBlockApps mercataAddress
  ++ [(".logicContract", BAccount $ unspecifiedChain feeCollectorImplAddress)]

voucher :: AccountInfo
voucher = SolidVMContractWithStorage voucherAddress 0 proxy $ ownedByBlockApps mercataAddress
  ++ [ ("._name", BString "Voucher")
     , (".logicContract", BAccount $ unspecifiedChain voucherImplAddress)
     , ("._symbol", BString "VOUCHER")
     , ("._totalSupply", BInteger $ 1_000_000 * oneE18)
     , ("._balances<a:" <> addrBS blockappsAddress <> ">", BInteger $ 1_000_000 * oneE18)
     ]

mToken :: AccountInfo
mToken = SolidVMContractWithStorage mTokenAddress 0 proxy $ ownedByBlockApps mercataAddress
  ++ [ ("._name", BString "MUSDST")
     , (".logicContract", BAccount $ unspecifiedChain tokenImplAddress)
     , ("._symbol", BString "MUSDST")
     , (".description", BString "MUSDST")
     , (".customDecimals", BInteger 18)
     , ("._totalSupply", BInteger $ 250_000 * oneE18)
     , (".tokenFactory", BContract "TokenFactory" $ unspecifiedChain tokenFactoryAddress)
     , (".status", BEnumVal "TokenStatus" "ACTIVE" 2)
     , ("._balances<a:" <> addrBS blockappsAddress <> ">", BInteger $ 250_000 * oneE18)
     ]

rewardsChef :: AccountInfo
rewardsChef = SolidVMContractWithStorage rewardsChefAddress 0 proxy $ ownedByBlockApps mercataAddress
  ++ [ (".MAX_INT", BInteger 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff)
     , (".PRECISION_MULTIPLIER", BInteger oneE18)
     , (".rewardToken", BContract "Token" $ unspecifiedChain cataAddress)
     , (".logicContract", BAccount $ unspecifiedChain rewardsChefImplAddress)
     , (".cataPerSecond", BInteger 100000000000000)
     , (".totalAllocPoint", BInteger 600)
     , (".minFutureTime", BInteger 3600)
     -- lpTokenInUse mapping entries
     , (".lpTokenInUse<a:" <> addrBS mTokenAddress <> ">", BBool True)
     , (".lpTokenInUse<a:" <> addrBS sUsdstAddress <> ">", BBool True)
     , (".lpTokenInUse<a:" <> addrBS goldstLpTokenAddress <> ">", BBool True)
     , (".lpTokenInUse<a:" <> addrBS silvstLpTokenAddress <> ">", BBool True)
     , (".lpTokenInUse<a:" <> addrBS ethstLpTokenAddress <> ">", BBool True)
     , (".lpTokenInUse<a:" <> addrBS wbtcstLpTokenAddress <> ">", BBool True)
     -- mUSDST
     , (".pools[0].lpToken", BAccount $ unspecifiedChain mTokenAddress)
     , (".pools[0].allocPoint", BInteger 100)
     , (".pools[0].lastRewardTimestamp", BInteger lastAccrual)
     , (".pools[0].accPerToken", BInteger 0)
     , (".pools[0].bonusPeriods[0].startTimestamp", BInteger lastAccrual)
     , (".pools[0].bonusPeriods[0].bonusMultiplier", BInteger 1)
     , (".pools[0].bonusPeriods.length", BInteger 1)
     -- sUSDST
     , (".pools[1].lpToken", BAccount $ unspecifiedChain sUsdstAddress)
     , (".pools[1].allocPoint", BInteger 100)
     , (".pools[1].lastRewardTimestamp", BInteger lastAccrual)
     , (".pools[1].accPerToken", BInteger 0)
     , (".pools[1].bonusPeriods[0].startTimestamp", BInteger lastAccrual)
     , (".pools[1].bonusPeriods[0].bonusMultiplier", BInteger 1)
     , (".pools[1].bonusPeriods.length", BInteger 1)
     -- goldst
     , (".pools[2].lpToken", BAccount $ unspecifiedChain goldstLpTokenAddress)
     , (".pools[2].allocPoint", BInteger 100)
     , (".pools[2].lastRewardTimestamp", BInteger lastAccrual)
     , (".pools[2].accPerToken", BInteger 0)
     , (".pools[2].bonusPeriods[0].startTimestamp", BInteger lastAccrual)
     , (".pools[2].bonusPeriods[0].bonusMultiplier", BInteger 1)
     , (".pools[2].bonusPeriods.length", BInteger 1)
     -- silvst
     , (".pools[3].lpToken", BAccount $ unspecifiedChain silvstLpTokenAddress)
     , (".pools[3].allocPoint", BInteger 100)
     , (".pools[3].lastRewardTimestamp", BInteger lastAccrual)
     , (".pools[3].accPerToken", BInteger 0)
     , (".pools[3].bonusPeriods[0].startTimestamp", BInteger lastAccrual)
     , (".pools[3].bonusPeriods[0].bonusMultiplier", BInteger 1)
     , (".pools[3].bonusPeriods.length", BInteger 1)
     -- ethst
     , (".pools[4].lpToken", BAccount $ unspecifiedChain ethstLpTokenAddress)
     , (".pools[4].allocPoint", BInteger 100)
     , (".pools[4].lastRewardTimestamp", BInteger lastAccrual)
     , (".pools[4].accPerToken", BInteger 0)
     , (".pools[4].bonusPeriods[0].startTimestamp", BInteger lastAccrual)
     , (".pools[4].bonusPeriods[0].bonusMultiplier", BInteger 1)
     , (".pools[4].bonusPeriods.length", BInteger 1)
     -- wbtcst
     , (".pools[5].lpToken", BAccount $ unspecifiedChain wbtcstLpTokenAddress)
     , (".pools[5].allocPoint", BInteger 100)
     , (".pools[5].lastRewardTimestamp", BInteger lastAccrual)
     , (".pools[5].accPerToken", BInteger 0)
     , (".pools[5].bonusPeriods[0].startTimestamp", BInteger lastAccrual)
     , (".pools[5].bonusPeriods[0].bonusMultiplier", BInteger 1)
     , (".pools[5].bonusPeriods.length", BInteger 1)
     -- pools length
     , (".pools.length", BInteger 6)
     ]

cdpEngine :: AccountInfo
cdpEngine = SolidVMContractWithStorage cdpEngineAddress 0 proxy $ ownedByBlockApps mercataAddress
  ++ [ (".registry", BContract "CDPRegistry" $ unspecifiedChain cdpRegistryAddress)
     , (".logicContract", BAccount $ unspecifiedChain cdpEngineImplAddress)
     , (".globalPaused", BBool False)
     , (".RAY", BInteger ray)
     , (".WAD", BInteger oneE18)
     , (".collateralConfigs<a:" <> addrBS usdstAddress <> ">.unitScale", BInteger oneE18)
     , (".collateralConfigs<a:" <> addrBS usdstAddress <> ">.debtCeiling", BInteger $ 10_000_000 * oneE18)
     , (".collateralConfigs<a:" <> addrBS usdstAddress <> ">.closeFactorBps", BInteger 5_000)
     , (".collateralConfigs<a:" <> addrBS usdstAddress <> ">.liquidationRatio", BInteger $ 3 * oneE18 `div` 2)
     , (".collateralConfigs<a:" <> addrBS usdstAddress <> ">.stabilityFeeRate", BInteger $ ray + 627_937_192_293_877_252)
     , (".collateralConfigs<a:" <> addrBS usdstAddress <> ">.liquidationPenaltyBps", BInteger 1_000)
     , (".collateralGlobalStates<a:" <> addrBS usdstAddress <> ">.rateAccumulator", BInteger ray)
     , (".collateralGlobalStates<a:" <> addrBS usdstAddress <> ">.lastAccrual", BInteger lastAccrual)
     , (".collateralGlobalStates<a:" <> addrBS usdstAddress <> ">.totalScaledDebt", BInteger 0)
     , (".isSupportedAsset<a:" <> addrBS usdstAddress <> ">", BBool True)
     , (".feeToReserveBps", BInteger 0)
     , (".juniorPremiumBps", BInteger 0)
     , (".juniorIndex", BInteger ray)
     , (".totalJuniorOutstandingUSDST", BInteger 0)
     , (".prevReserveBalance", BInteger 0)
     ]
  ++ concatMap (\a ->
    [ (".collateralConfigs<a:" <> addrBS a <> ">.debtFloor", BInteger oneE18)
    , (".collateralConfigs<a:" <> addrBS a <> ">.unitScale", BInteger oneE18)
    , (".collateralConfigs<a:" <> addrBS a <> ">.debtCeiling", BInteger $ 10_000_000 * oneE18)
    , (".collateralConfigs<a:" <> addrBS a <> ">.closeFactorBps", BInteger 5_000)
    , (".collateralConfigs<a:" <> addrBS a <> ">.liquidationRatio", BInteger $ 3 * oneE18 `div` 2)
    , (".collateralConfigs<a:" <> addrBS a <> ">.stabilityFeeRate", BInteger $ ray + 627_937_192_293_877_252)
    , (".collateralConfigs<a:" <> addrBS a <> ">.liquidationPenaltyBps", BInteger 1_000)
    , (".collateralGlobalStates<a:" <> addrBS a <> ">.rateAccumulator", BInteger ray)
    , (".collateralGlobalStates<a:" <> addrBS a <> ">.lastAccrual", BInteger lastAccrual)
    , (".collateralGlobalStates<a:" <> addrBS a <> ">.totalScaledDebt", BInteger . sum . map GE.borrowedAmount $ filter ((== a) . GE.assetRootAddress) combinedEscrows)
    , (".isSupportedAsset<a:" <> addrBS a <> ">", BBool True)
    ]
  ) supportedCollaterals
  ++ concatMap (\GE.Escrow{..} ->
    [ (".vaults<a:" <> addrBS borrower <> "><a:" <> addrBS assetRootAddress <> ">.scaledDebt", BInteger borrowedAmount)
    , (".vaults<a:" <> addrBS borrower <> "><a:" <> addrBS assetRootAddress <> ">.collateral", BInteger collateralQuantity)
    ]) combinedEscrows

cdpEngineEvents :: (Address, S.Seq Event)
cdpEngineEvents = (\(a, evs) -> (a, (\(n,v) -> Event KECCAK256.zeroHash "BlockApps" "Mercata" "CDPEngine" a n ((\(v1,v2) -> (v1,v2,"Other")) <$> v)) <$> evs)) (cdpEngineAddress, S.fromList $
  map (\GE.Escrow{..} ->
    ("Deposited", [("user", show borrower), ("asset", show assetRootAddress), ("amount", show collateralQuantity)])
  ) combinedEscrows
  ++ map (\a ->
    ("Deposited",
      [ ("asset", show a)
      , ("liquidationRatio", show $ 3 * oneE18 `div` 2)
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

cdpRegistry :: AccountInfo
cdpRegistry = SolidVMContractWithStorage cdpRegistryAddress 0 proxy $ ownedByBlockApps mercataAddress
  ++ [ (".cdpVault", BContract "CDPVault" $ unspecifiedChain cdpVaultAddress)
     , (".logicContract", BAccount $ unspecifiedChain cdpRegistryImplAddress)
     , (".cdpEngine", BContract "CDPEngine" $ unspecifiedChain cdpEngineAddress)
     , (".cdpReserve", BContract "CDPReserve" $ unspecifiedChain cdpReserveAddress)
     , (".priceOracle", BContract "PriceOracle" $ unspecifiedChain priceOracleAddress)
     , (".usdst", BContract "Token" $ unspecifiedChain usdstAddress)
     , (".tokenFactory", BContract "TokenFactory" $ unspecifiedChain tokenFactoryAddress)
     , (".feeCollector", BContract "FeeCollector" $ unspecifiedChain feeCollectorAddress)
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

cdpVault :: AccountInfo
cdpVault = SolidVMContractWithStorage cdpVaultAddress 0 proxy $ ownedByBlockApps mercataAddress
  ++ [ (".registry", BContract "CDPRegistry" $ unspecifiedChain cdpRegistryAddress)
     , (".logicContract", BAccount $ unspecifiedChain cdpVaultImplAddress)
     ]
  ++ concatMap (\GE.Escrow{..} ->
    [ (".userCollaterals<a:" <> addrBS borrower <> "><a:" <> addrBS assetRootAddress <> ">", BInteger collateralQuantity)
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

cdpReserve :: AccountInfo
cdpReserve = SolidVMContractWithStorage cdpReserveAddress 0 proxy $ ownedByBlockApps mercataAddress
  ++ [ (".registry", BContract "CDPRegistry" $ unspecifiedChain cdpRegistryAddress)
     , (".logicContract", BAccount $ unspecifiedChain cdpReserveImplAddress)
     ]

safetyModule :: AccountInfo
safetyModule = SolidVMContractWithStorage safetyModuleAddress 0 proxy $ ownedByBlockApps mercataAddress
  ++ [ (".lendingRegistry", BContract "LendingRegistry" $ unspecifiedChain lendingRegistryAddress)
     , (".logicContract", BAccount $ unspecifiedChain safetyModuleImplAddress)
     , (".lendingPool", BContract "LendingPool" $ unspecifiedChain lendingPoolAddress)
     , (".liquidityPool", BContract "LiquidityPool" $ unspecifiedChain liquidityPoolAddress)
     , (".tokenFactory", BContract "TokenFactory" $ unspecifiedChain tokenFactoryAddress)
     , (".asset", BAccount $ unspecifiedChain usdstAddress)
     , (".sToken", BAccount $ unspecifiedChain sUsdstAddress)
     , (".COOLDOWN_SECONDS", BInteger 1)
     , (".UNSTAKE_WINDOW", BInteger 432000)
     , (".MAX_SLASH_BPS", BInteger 3000)
     ]

safetyModuleEvents :: (Address, S.Seq Event)
safetyModuleEvents = (\(a, evs) -> (a, (\(n,v) -> Event KECCAK256.zeroHash "BlockApps" "Mercata" "SafetyModule" a n ((\(v1,v2) -> (v1,v2,"Other")) <$> v)) <$> evs)) (safetyModuleAddress, S.fromList $
  [ ("ParamsUpdated", [("cooldown", show (1 :: Integer)), ("window", show (432000 :: Integer)), ("maxSlashBps", show (3000 :: Integer))])
  , ("TokensUpdated", [("_asset", show usdstAddress), ("_sToken", show sUsdstAddress)])
  ])

sUsdst :: AccountInfo
sUsdst = SolidVMContractWithStorage sUsdstAddress 0 proxy $ ownedByBlockApps mercataAddress
  ++ [ ("._name", BString "sUSDST")
     , (".logicContract", BAccount $ unspecifiedChain tokenImplAddress)
     , ("._symbol", BString "SUSDST")
     , (".description", BString "sUSDST")
     , (".customDecimals", BInteger 18)
     , ("._totalSupply", BInteger 0)
     , (".tokenFactory", BContract "TokenFactory" $ unspecifiedChain tokenFactoryAddress)
     , (".status", BEnumVal "TokenStatus" "ACTIVE" 2)
     ]

ethstPool :: AccountInfo
ethstPool = SolidVMContractWithStorage ethstPoolAddress 0 proxy $ ownedByBlockApps mercataAddress
  ++ [ (".poolFactory", BAccount $ unspecifiedChain poolFactoryAddress)
     , (".logicContract", BAccount $ unspecifiedChain poolImplAddress)
     , (".tokenA", BContract "Token" $ unspecifiedChain ethstRoot)
     , (".tokenB", BContract "Token" $ unspecifiedChain usdstAddress)
     , (".lpToken", BContract "Token" $ unspecifiedChain ethstLpTokenAddress)
     , (".locked", BBool False)
     , (".aToBRatio", BDecimal "0.00022258577")
     , (".bToARatio", BDecimal "4492.65")
     , (".tokenABalance", BInteger 11_129_288_949_700_000_000)
     , (".tokenBBalance", BInteger $ 50_000 * oneE18)
     , (".swapFeeRate", BInteger 0)
     , (".lpSharePercent", BInteger 0)
     , (".zapSwapFeesEnabled", BBool True)
     ]

ethstLpToken :: AccountInfo
ethstLpToken = SolidVMContractWithStorage ethstLpTokenAddress 0 proxy $ ownedByBlockApps mercataAddress
  ++ [ ("._name", BString "ETHST-USDST LP Token")
     , (".logicContract", BAccount $ unspecifiedChain tokenImplAddress)
     , ("._symbol", BString "ETHST-USDST-LP")
     , (".description", BString "Liquidity Provider Token")
     , (".customDecimals", BInteger 18)
     , ("._totalSupply", BInteger $ 50_000 * oneE18)
     , (".tokenFactory", BContract "TokenFactory" $ unspecifiedChain tokenFactoryAddress)
     , (".status", BEnumVal "TokenStatus" "ACTIVE" 2)
     , ("._balances<a:" <> addrBS blockappsAddress <> ">", BInteger $ 50_000 * oneE18)
     ]

wbtcstPool :: AccountInfo
wbtcstPool = SolidVMContractWithStorage wbtcstPoolAddress 0 proxy $ ownedByBlockApps mercataAddress
  ++ [ (".poolFactory", BAccount $ unspecifiedChain poolFactoryAddress)
     , (".logicContract", BAccount $ unspecifiedChain poolImplAddress)
     , (".tokenA", BContract "Token" $ unspecifiedChain wbtcstRoot)
     , (".tokenB", BContract "Token" $ unspecifiedChain usdstAddress)
     , (".lpToken", BContract "Token" $ unspecifiedChain wbtcstLpTokenAddress)
     , (".locked", BBool False)
     , (".aToBRatio", BDecimal "0.0000085")
     , (".bToARatio", BDecimal "117647.058824")
     , (".tokenABalance", BInteger $ (425 * oneE18) `div` 1000)
     , (".tokenBBalance", BInteger $ 50_000 * oneE18)
     , (".swapFeeRate", BInteger 0)
     , (".lpSharePercent", BInteger 0)
     , (".zapSwapFeesEnabled", BBool True)
     ]

wbtcstLpToken :: AccountInfo
wbtcstLpToken = SolidVMContractWithStorage wbtcstLpTokenAddress 0 proxy $ ownedByBlockApps mercataAddress
  ++ [ ("._name", BString "WBTCST-USDST LP Token")
     , (".logicContract", BAccount $ unspecifiedChain tokenImplAddress)
     , ("._symbol", BString "WBTCST-USDST-LP")
     , (".description", BString "Liquidity Provider Token")
     , (".customDecimals", BInteger 18)
     , ("._totalSupply", BInteger $ 50_000 * oneE18)
     , (".tokenFactory", BContract "TokenFactory" $ unspecifiedChain tokenFactoryAddress)
     , (".status", BEnumVal "TokenStatus" "ACTIVE" 2)
     , ("._balances<a:" <> addrBS blockappsAddress <> ">", BInteger $ 50_000 * oneE18)
     ]

goldstPool :: AccountInfo
goldstPool = SolidVMContractWithStorage goldstPoolAddress 0 proxy $ ownedByBlockApps mercataAddress
  ++ [ (".poolFactory", BAccount $ unspecifiedChain poolFactoryAddress)
     , (".logicContract", BAccount $ unspecifiedChain poolImplAddress)
     , (".tokenA", BContract "Token" $ unspecifiedChain goldstRoot)
     , (".tokenB", BContract "Token" $ unspecifiedChain usdstAddress)
     , (".lpToken", BContract "Token" $ unspecifiedChain goldstLpTokenAddress)
     , (".locked", BBool False)
     , (".aToBRatio", BDecimal "0.000302")
     , (".bToARatio", BDecimal "3311.25827815")
     , (".tokenABalance", BInteger $ (151 * oneE18) `div` 10)
     , (".tokenBBalance", BInteger $ 50_000 * oneE18)
     , (".swapFeeRate", BInteger 0)
     , (".lpSharePercent", BInteger 0)
     , (".zapSwapFeesEnabled", BBool True)
     ]

goldstLpToken :: AccountInfo
goldstLpToken = SolidVMContractWithStorage goldstLpTokenAddress 0 proxy $ ownedByBlockApps mercataAddress
  ++ [ ("._name", BString "GOLDST-USDST LP Token")
     , (".logicContract", BAccount $ unspecifiedChain tokenImplAddress)
     , ("._symbol", BString "GOLDST-USDST-LP")
     , (".description", BString "Liquidity Provider Token")
     , (".customDecimals", BInteger 18)
     , ("._totalSupply", BInteger $ 50_000 * oneE18)
     , (".tokenFactory", BContract "TokenFactory" $ unspecifiedChain tokenFactoryAddress)
     , (".status", BEnumVal "TokenStatus" "ACTIVE" 2)
     , ("._balances<a:" <> addrBS blockappsAddress <> ">", BInteger $ 50_000 * oneE18)
     ]

silvstPool :: AccountInfo
silvstPool = SolidVMContractWithStorage silvstPoolAddress 0 proxy $ ownedByBlockApps mercataAddress
  ++ [ (".poolFactory", BAccount $ unspecifiedChain poolFactoryAddress)
     , (".logicContract", BAccount $ unspecifiedChain poolImplAddress)
     , (".tokenA", BContract "Token" $ unspecifiedChain silvstRoot)
     , (".tokenB", BContract "Token" $ unspecifiedChain usdstAddress)
     , (".lpToken", BContract "Token" $ unspecifiedChain silvstLpTokenAddress)
     , (".locked", BBool False)
     , (".aToBRatio", BDecimal "0.02625")
     , (".bToARatio", BDecimal "38.0952380952")
     , (".tokenABalance", BInteger $ (13_125 * oneE18) `div` 10)
     , (".tokenBBalance", BInteger $ 50_000 * oneE18)
     , (".swapFeeRate", BInteger 0)
     , (".lpSharePercent", BInteger 0)
     , (".zapSwapFeesEnabled", BBool True)
     ]

silvstLpToken :: AccountInfo
silvstLpToken = SolidVMContractWithStorage silvstLpTokenAddress 0 proxy $ ownedByBlockApps mercataAddress
  ++ [ ("._name", BString "SILVST-USDST LP Token")
     , (".logicContract", BAccount $ unspecifiedChain tokenImplAddress)
     , ("._symbol", BString "SILVST-USDST-LP")
     , (".description", BString "Liquidity Provider Token")
     , (".customDecimals", BInteger 18)
     , ("._totalSupply", BInteger $ 50_000 * oneE18)
     , (".tokenFactory", BContract "TokenFactory" $ unspecifiedChain tokenFactoryAddress)
     , (".status", BEnumVal "TokenStatus" "ACTIVE" 2)
     , ("._balances<a:" <> addrBS blockappsAddress <> ">", BInteger $ 50_000 * oneE18)
     ]

-- paxgstPool :: AccountInfo
-- paxgstPool = SolidVMContractWithStorage paxgstPoolAddress 0 proxy $ ownedByBlockApps mercataAddress
--   ++ [ (".poolFactory", BAccount $ unspecifiedChain poolFactoryAddress)
--      , (".tokenA", BContract "Token" $ unspecifiedChain paxgstRoot)
--      , (".tokenB", BContract "Token" $ unspecifiedChain usdstAddress)
--      , (".lpToken", BContract "Token" $ unspecifiedChain paxgstLpTokenAddress)
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
-- paxgstLpToken :: AccountInfo
-- paxgstLpToken = SolidVMContractWithStorage paxgstLpTokenAddress 0 proxy $ ownedByBlockApps mercataAddress
--   ++ [ ("._name", BString "PAXGST-USDST LP Token")
--      , ("._symbol", BString "PAXGST-USDST-LP")
--      , (".description", BString "Liquidity Provider Token")
--      , (".customDecimals", BInteger 18)
--      , ("._totalSupply", BInteger $ 200_000 * oneE18)
--      , (".tokenFactory", BContract "TokenFactory" $ unspecifiedChain tokenFactoryAddress)
--      , (".status", BEnumVal "TokenStatus" "ACTIVE" 2)
--      , ("._balances<a:" <> addrBS blockappsAddress <> ">", BInteger $ 200_000 * oneE18)
--      ]

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
