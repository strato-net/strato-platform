{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TypeApplications #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

module Strato.TypesSpec where

import Bloc.API.TypeWrappers
import Data.Aeson
import Test.Hspec
import Test.Hspec.QuickCheck
import Test.QuickCheck
import Test.QuickCheck.Instances ()
import Text.Read

spec :: Spec
spec = modifyMaxSuccess (const 10) $ do
  describe "Strung" $
    prop "has inverse JSON decode/encode" $ jsonProp @(Strung Integer)
  describe "Hex" $ do
    prop "has inverse JSON decode/encode" $ jsonProp @(Hex Word)
    prop "has inverse read/show" $ readShowProp @(Hex Word)

-- helpers

jsonProp :: (Eq x, Show x, FromJSON x, ToJSON x) => x -> Property
jsonProp = liftA2 (===) (decode . encode) Just

readShowProp :: (Eq x, Read x, Show x) => x -> Property
readShowProp = liftA2 (===) (readMaybe . show) Just
