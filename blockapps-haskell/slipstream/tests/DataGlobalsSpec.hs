{-# LANGUAGE OverloadedStrings #-}
module DataGlobalsSpec where

import ClassyPrelude
import qualified Prelude as P()

import Test.Hspec (Spec, describe, it)
import Test.QuickCheck

import Slipstream.Data.Globals

dropOrg :: CodePtr -> CodePtr
dropOrg (SolidVMCode s _ k) = SolidVMCode s "" k
dropOrg scptr               = scptr

spec :: Spec
spec = describe "Slipstream.Data.Globals.CodePtr" $ do
    it "convertFromSlipCodePtr is an inverse of convertToSlipCodePtr x, where x is arbitrary" $ do
        property $ \cptr x -> (convertFromSlipCodePtr . (convertToSlipCodePtr `flip` x)) cptr == cptr

    it "convertToSlipCodePtr x is partial inverse of convertFromSlipCodePtr, where the org name is lost in SolidVMCode" $ do
        property $ \scptr x -> (dropOrg . (convertToSlipCodePtr `flip` x) . convertFromSlipCodePtr) scptr == dropOrg scptr