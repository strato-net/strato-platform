{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TypeApplications  #-}

module BlockApps.Strato.TypesSpec where

import           Control.Applicative
import           Data.Aeson
import           Test.Hspec
import           Test.Hspec.QuickCheck
import           Test.QuickCheck
import           Test.QuickCheck.Instances ()
import           Text.Read

import           BlockApps.Bloc22.API.TypeWrappers

spec :: Spec
spec = modifyMaxSuccess (const 10) $ do
  describe "Strung" $
    prop "has inverse JSON decode/encode" $ jsonProp @ (Strung Integer)
  describe "Hex" $ do
    prop "has inverse JSON decode/encode" $ jsonProp @ (Hex Word)
    prop "has inverse read/show" $ readShowProp @ (Hex Word)    

-- helpers

jsonProp :: (Eq x, Show x, FromJSON x, ToJSON x) => x -> Property
jsonProp = liftA2 (===) (decode . encode) Just

readShowProp :: (Eq x, Read x, Show x) => x -> Property
readShowProp = liftA2 (===) (readMaybe . show) Just
