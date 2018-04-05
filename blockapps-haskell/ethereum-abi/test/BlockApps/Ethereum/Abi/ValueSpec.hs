{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Ethereum.Abi.ValueSpec where

import           Data.ByteString              (ByteString)
import qualified Data.ByteString.Base16       as Base16
import           Test.Hspec

import           BlockApps.Ethereum
import           BlockApps.Ethereum.Abi.Type
import           BlockApps.Ethereum.Abi.Value

spec :: Spec
spec =
  describe "encodeValues" $
    describe "convert an array of arguments into a bytestring" $ do
      context "official Ethereum ABI Tests: found at https://github.com/ethereum/tests/blob/develop/ABITests/basic_abi_tests.json" $ do
        it "should convert 4 args with types: uint256, uint32[], bytes10, and bytes" $ encodeDecodeValues
          [ ValueUInt 291
            , ValueArrayDynamic
              [ ValueUInt 1110
              , ValueUInt 1929
              ]
            , ValueBytesStatic "1234567890"
            , ValueBytesDynamic "Hello, world!"
            ]
          [ TypeUInt (Just 256)
          , TypeArrayDynamic (TypeUInt (Just 32))
          , TypeBytesStatic 10
          , TypeBytesDynamic
          ]
          "00000000000000000000000000000000000000000000000000000000000001230000000000000000000000000000000000000000000000000000000000000080313233343536373839300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000004560000000000000000000000000000000000000000000000000000000000000789000000000000000000000000000000000000000000000000000000000000000d48656c6c6f2c20776f726c642100000000000000000000000000000000000000"

        it "should convert 1 arg with type uint256" $ encodeDecodeValues
          [ ValueUInt 98127491 ]
          [ TypeUInt (Just 256) ]
          "0000000000000000000000000000000000000000000000000000000005d94e83"

        it "should convert 2 arg with type uint256, address" $ encodeDecodeValues
          [ ValueUInt 324124
          , ValueAddress $
              Address 0xcd2a3d9f938e13cd947ec05abc7fe734df8dd826
          ]
          [ TypeUInt (Just 256)
          , TypeAddress
          ]
          "000000000000000000000000000000000000000000000000000000000004f21c000000000000000000000000cd2a3d9f938e13cd947ec05abc7fe734df8dd826"

      it "should convert 1 arg with type uint" $ encodeDecodeValues
        [ ValueUInt 3 ]
        [ TypeUInt Nothing ]
        "0000000000000000000000000000000000000000000000000000000000000003"

      it "should convert 1 arg with type int" $ encodeDecodeValues
        [ ValueInt (-1) ]
        [ TypeInt Nothing ]
        "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

      it "should convert 1 arg with type address" $ encodeDecodeValues
        [ ValueAddress $ Address 0xdeadbeef ]
        [ TypeAddress ]
        "00000000000000000000000000000000000000000000000000000000deadbeef"

      it "should convert 1 arg with type bytes" $ do
        pendingWith "Need to find a correct bytestring to compare against, blockapps-js returns empty-string"
        let
          bytes16 = "adb591795f9e9047f9117163b83c2ebcd5edc4503644d59a98cf911aef0367f8adb591795f9e9047f9117163b83c2ebcd5edc4503644"
          (bytes,_) = Base16.decode bytes16
        encodeDecodeValues
          [ ValueBytesDynamic bytes ]
          [ TypeBytesDynamic ]
          undefined

      it "should convert 1 arg with type bytes32" $ do
        let
          bytes16 = "adb591795f9e9047f9117163b83c2ebcd5edc4503644d59a98cf911aef0367f8"
          (bytes,_) = Base16.decode bytes16
        encodeDecodeValues
          [ ValueBytesStatic bytes ]
          [ TypeBytesStatic 32 ]
          bytes16

      it "should convert 1 arg with type bool" $ encodeDecodeValues
        [ ValueBool True ]
        [ TypeBool ]
        "0000000000000000000000000000000000000000000000000000000000000001"

      it "should convert 1 arg with type string" $ do
        let
          str =
            "Out the back Pipe punt combo Craig Anderson inner bar glass freshie\
            \ air drop. Claw hands pumping make the paddle spray Ocean Beach surfing hollow turds in the \
            \lineup over the reef Mavericks. Taj Burrow crumbly lip flow carves top turn barreling sandbar.\
            \ Pose on the nose blonde rigs lip pumping good poked the nose, Snapper Rocks."
        encodeDecodeValues
          [ ValueString str ]
          [ TypeString ]
          "0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000014a4f757420746865206261636b20506970652070756e7420636f6d626f20437261696720416e646572736f6e20696e6e65722062617220676c6173732066726573686965206169722064726f702e20436c61772068616e64732070756d70696e67206d616b652074686520706164646c65207370726179204f6365616e2042656163682073757266696e6720686f6c6c6f7720747572647320696e20746865206c696e657570206f766572207468652072656566204d6176657269636b732e2054616a20427572726f77206372756d626c79206c697020666c6f772063617276657320746f70207475726e2062617272656c696e672073616e646261722e20506f7365206f6e20746865206e6f736520626c6f6e64652072696773206c69702070756d70696e6720676f6f6420706f6b656420746865206e6f73652c20536e617070657220526f636b732e00000000000000000000000000000000000000000000"

      it "should convert 1 arg with type uint[]" $ encodeDecodeValues
        [ ValueArrayDynamic
          [ ValueUInt i | i <- [1,2,3,4,4,5,66,75,754,98] ]
        ]
        [ TypeArrayDynamic (TypeUInt Nothing) ]
        "0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000050000000000000000000000000000000000000000000000000000000000000042000000000000000000000000000000000000000000000000000000000000004b00000000000000000000000000000000000000000000000000000000000002f20000000000000000000000000000000000000000000000000000000000000062"

      it "should convert 1 arg with type uint[3]" $ encodeDecodeValues
        [ ValueArrayStatic [ ValueUInt i | i <- [1,2,3] ] ]
        [ TypeArrayStatic 3 (TypeUInt Nothing) ]
        "000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000003"

encodeDecodeValues :: [Value] -> [Type] -> ByteString -> Expectation
encodeDecodeValues args argTypes bytes16 = do
  zipWith validValue argTypes args `shouldSatisfy` and
  let (encoded,_) = Base16.decode bytes16
  encodeValues args `shouldBe` encoded
  decodeValues encoded argTypes `shouldBe` Just args
