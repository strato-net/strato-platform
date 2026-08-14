{-# LANGUAGE OverloadedStrings #-}

module AcrossLocalSpec where

import Blockchain.Data.GenesisInfo
import Blockchain.GenesisBlocks.HeliumGenesisBlock
import Blockchain.Strato.Model.Validator
import qualified Data.ByteString.Char8 as BC
import Data.String (fromString)
import SolidVM.Model.Storable (BasicValue (BInteger))
import Test.Hspec

spec :: Spec
spec = describe "Across local genesis" $ do
  it "uses exactly the deterministic test validator" $
    validators acrossLocalGenesisBlock
      `shouldBe` [Validator acrossLocalValidatorAddress]

  it "funds the deterministic test validator" $
    any isFundedValidator (addressInfo acrossLocalGenesisBlock) `shouldBe` True

  it "funds the public disposable relayer account" $
    any isFundedRelayer (addressInfo acrossLocalGenesisBlock) `shouldBe` True

  it "keeps the validator first and disposable relayer second" $
    take 2 (nonContractAddresses $ addressInfo acrossLocalGenesisBlock)
      `shouldBe` [acrossLocalValidatorAddress, acrossLocalRelayerAddress]

  it "funds the relayer in USDST, the network fee currency" $
    any hasRelayerUsdST (addressInfo acrossLocalGenesisBlock) `shouldBe` True

  it "increments USDST total supply by exactly the relayer funding" $
    tokenInteger "_totalSupply" acrossLocalGenesisBlock
      `shouldBe` (+ acrossLocalRelayerGasFunding)
        <$> tokenInteger "_totalSupply" (genesisBlockTemplate acrossLocalConfig)

  it "can use an operator-supplied validator without changing the profile" $ do
    let validatorAddress = 0x1234567890abcdef1234567890abcdef12345678
        genesis = acrossGenesisBlock validatorAddress
    validators genesis `shouldBe` [Validator validatorAddress]
    any (isFundedAddress validatorAddress) (addressInfo genesis) `shouldBe` True

  it "does not fund the public replay relayer in an operator-key network" $ do
    let validatorAddress = 0x1234567890abcdef1234567890abcdef12345678
        genesis = acrossGenesisBlock validatorAddress
    any isFundedRelayer (addressInfo genesis) `shouldBe` False
    any hasRelayerUsdST (addressInfo genesis) `shouldBe` False
  where
    isFundedValidator (NonContract address balance) =
      address == acrossLocalValidatorAddress && balance > 0
    isFundedValidator _ = False
    isFundedAddress expected (NonContract address balance) =
      address == expected && balance > 0
    isFundedAddress _ _ = False
    isFundedRelayer (NonContract address balance) =
      address == acrossLocalRelayerAddress && balance == 100 * oneE18
    isFundedRelayer _ = False
    nonContractAddresses = foldr collect []
      where
        collect (NonContract address _) rest = address : rest
        collect _ rest = rest
    hasRelayerUsdST (SolidVMContractWithStorage address _ _ storage)
      | address == usdstAddress =
          lookup relayerBalancePath storage
            == Just (BInteger acrossLocalRelayerGasFunding)
      | otherwise = False
    hasRelayerUsdST _ = False
    relayerBalancePath =
      fromString . BC.unpack $
        "_balances[" <> addrBS acrossLocalRelayerAddress <> "]"

tokenInteger :: String -> GenesisInfo -> Maybe Integer
tokenInteger rawPath genesis = do
  SolidVMContractWithStorage _ _ _ storage <-
    findUsdST $ addressInfo genesis
  BInteger amount <- lookup (fromString rawPath) storage
  pure amount
  where
    findUsdST [] = Nothing
    findUsdST (contract@(SolidVMContractWithStorage address _ _ _) : rest)
      | address == usdstAddress = Just contract
      | otherwise = findUsdST rest
    findUsdST (_ : rest) = findUsdST rest
