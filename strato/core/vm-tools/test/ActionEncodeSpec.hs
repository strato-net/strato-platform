{-# LANGUAGE OverloadedStrings #-}

-- | 'Action' goes over the wire as its Store encoding wrapped in a Binary ByteString
-- (Blockchain.Stream.Action). This checks the round trip through the Binary instance,
-- via 'show' because 'Eq Value' is not structural on aggregates. Generators cover every
-- BasicValue constructor and the Value constructors that occur in events, Integer
-- boundaries and non-ASCII text; the QuickCheck size is capped because the nested
-- containers grow as size^4.
module ActionEncodeSpec (spec) where

import Blockchain.Stream.Action
import Blockchain.Stream.VMEvent (VMEvent (..))
import qualified Data.ByteString as B
import Data.Binary (decode, encode)
import Data.Decimal (Decimal, DecimalRaw (..))
import qualified Data.Map.Ordered as OMap
import qualified Data.Map.Strict as M
import qualified Data.Sequence as Seq
import qualified Data.Text as T
import qualified Data.Vector as V
import SolidVM.Model.Event
import SolidVM.Model.Storable
import SolidVM.Model.Value
import Test.Hspec
import Test.QuickCheck
import Test.QuickCheck.Instances ()

spec :: Spec
spec = describe "Blockchain.Stream.Action Binary (Store) encoding" $ do
  it "Action round-trips" $
    withMaxSuccess 2000 $ forAll (scale (min 12) genAction) $ \a ->
      show (decode (encode a) :: Action) === show a
  it "NewAction round-trips through VMEvent" $
    withMaxSuccess 500 $ forAll (scale (min 12) genAction) $ \a ->
      show (decode (encode (NewAction a)) :: VMEvent) === show (NewAction a)

genAction :: Gen Action
genAction =
  Action
    <$> arbitrary
    <*> arbitrary
    <*> genInteger
    <*> arbitrary
    <*> (OMap.fromList <$> listOf ((,) <$> arbitrary <*> (ActionData . SolidVMDiff . M.fromList <$> listOf ((,) <$> genPath <*> genBasic))))
    <*> pure OMap.empty
    <*> (Seq.fromList <$> listOf genEvent)
    <*> (Seq.fromList <$> listOf (Delegatecall <$> arbitrary <*> arbitrary <*> genText))

-- small, Int32-boundary, 64-bit-boundary and 256-bit magnitudes, both signs
genInteger :: Gen Integer
genInteger =
  oneof
    [ arbitrary
    , elements [0, 1, -1, 2147483647, 2147483648, -2147483648, -2147483649, 2 ^ (64 :: Int) - 1, 2 ^ (64 :: Int), 2 ^ (256 :: Int) - 1, -(2 ^ (255 :: Int))]
    , choose (-(2 ^ (256 :: Int)), 2 ^ (256 :: Int))
    ]

-- ASCII, escapable and non-ASCII text
genText :: Gen T.Text
genText = T.pack <$> genString

genString :: Gen String
genString = listOf (frequency [(20, choose ('a', 'z')), (3, elements "\"\\\n\t\SO\DEL \1234"), (2, arbitrary)])

genPath :: Gen StoragePath
genPath = StoragePath <$> listOf (oneof [Field <$> arbitrary, Index <$> arbitrary])

genBasic :: Gen BasicValue
genBasic =
  oneof
    [ BInteger <$> genInteger
    , BString <$> arbitrary
    , BBytes <$> arbitrary
    , BDecimal <$> arbitrary
    , BBool <$> arbitrary
    , BAddress <$> arbitrary
    , BEnumVal <$> genText <*> genText <*> arbitrary
    , BContract <$> genText <*> arbitrary
    , pure BDefault
    ]

genEvent :: Gen Event
genEvent =
  Event
    <$> arbitrary
    <*> arbitrary
    <*> genText
    <*> arbitrary
    <*> genText
    <*> listOf ((,) <$> genText <*> genValue (2 :: Int))
    <*> listOf (B.pack <$> vectorOf 32 arbitrary)

-- the scalar constructors, the aggregates (with Constant elements) and a storage reference
genValue :: Int -> Gen Value
genValue depth =
  oneof $
    [ SInteger <$> genInteger
    , SDecimal <$> genDecimal
    , SString <$> genString
    , SBool <$> arbitrary
    , SAddress <$> arbitrary <*> arbitrary
    , SEnumVal <$> genText <*> genText <*> arbitrary
    , SContract <$> genText <*> arbitrary
    , SBytes <$> arbitrary
    , pure SNULL
    , pure SBreak
    , SReference <$> genPath
    ]
      ++ if depth <= 0
        then []
        else
          [ SStruct <$> genText <*> (M.fromList <$> listOf ((,) <$> genText <*> (Constant <$> genValue (depth - 1))))
          , STuple . V.fromList <$> listOf (Constant <$> genValue (depth - 1))
          , SArray . V.fromList <$> listOf (Constant <$> genValue (depth - 1))
          , -- 'Ord Value' is only defined within one constructor, so keys are all integers
            SMap . M.fromList <$> listOf ((,) <$> (SInteger <$> genInteger) <*> (Constant <$> genValue (depth - 1)))
          ]

genDecimal :: Gen Decimal
genDecimal = Decimal <$> arbitrary <*> genInteger
