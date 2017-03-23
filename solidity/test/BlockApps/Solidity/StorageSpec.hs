{-# LANGUAGE
  OverloadedStrings #-}

module BlockApps.Solidity.StorageSpec where

import qualified Data.ByteString.Base16 as Base16
import Test.Hspec

import BlockApps.Ethereum
import BlockApps.Solidity.Storage
import BlockApps.Solidity.Value

spec :: Spec
spec =
  describe "toStorage" $ do
    describe "convert an array of arguments into a bytestring" $ do
      context "official Ethereum ABI Tests: found at https://github.com/ethereum/tests/blob/develop/ABITests/basic_abi_tests.json" $ do
        it "should convert 4 args with types: uint256, uint32[], bytes10, and bytes" $ do
          let
            args = ValueArrayFixed 4
                    [ SimpleValue (ValueUInt256 291)
                    , ValueArrayDynamic [ SimpleValue (ValueUInt32 1110)
                                        , SimpleValue (ValueUInt32 1929)
                                        ]
                    , SimpleValue (ValueBytes10 "1234567890")
                    , SimpleValue (ValueBytes "Hello, world!")
                    ]
            (dataBytestring,_) = Base16.decode "00000000000000000000000000000000000000000000000000000000000001230000000000000000000000000000000000000000000000000000000000000080313233343536373839300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000004560000000000000000000000000000000000000000000000000000000000000789000000000000000000000000000000000000000000000000000000000000000d48656c6c6f2c20776f726c642100000000000000000000000000000000000000"
          toStorage args `shouldBe` dataBytestring
        it "should convert 1 arg with type uint256" $ do
          let
            args = ValueArrayFixed 1
                    [ SimpleValue (ValueUInt256 98127491) ]
            (dataBytestring,_) = Base16.decode "0000000000000000000000000000000000000000000000000000000005d94e83"
          toStorage args `shouldBe` dataBytestring
        it "should convert 2 arg with type uint256, addresss" $ do
          let
            args = ValueArrayFixed 2
                    [ SimpleValue (ValueUInt256 324124), SimpleValue (ValueAddress (Address 0xcd2a3d9f938e13cd947ec05abc7fe734df8dd826))]
            (dataBytestring,_) = Base16.decode "000000000000000000000000000000000000000000000000000000000004f21c000000000000000000000000cd2a3d9f938e13cd947ec05abc7fe734df8dd826"
          toStorage args `shouldBe` dataBytestring
      it "should convert 1 arg with type uint" $ do
        let
          args = ValueArrayFixed 1
                  [ SimpleValue (ValueUInt 3) ]
          (dataBytestring,_) = Base16.decode "0000000000000000000000000000000000000000000000000000000000000003"
        toStorage args `shouldBe` dataBytestring
      it "should convert 1 arg with type int" $ do
        let
          args = ValueArrayFixed 1
                  [ SimpleValue (ValueInt (-1)) ]
          (dataBytestring,_) = Base16.decode "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
        toStorage args `shouldBe` dataBytestring
      it "should convert 1 arg with type address" $ do
        let
          args = ValueArrayFixed 1
                  [ SimpleValue (ValueAddress (Address 0xdeadbeef)) ]
          (dataBytestring,_) = Base16.decode "00000000000000000000000000000000000000000000000000000000deadbeef"
        toStorage args `shouldBe` dataBytestring
      it "should convert 1 arg with type bytes" $ do
        pendingWith "Need to find a correct bytestring to compare against, blockapps-js returns empty-string"
        let
          args = ValueArrayFixed 1
            [ SimpleValue $ ValueBytes
              (fst $ Base16.decode "adb591795f9e9047f9117163b83c2ebcd5edc4503644d59a98cf911aef0367f8adb591795f9e9047f9117163b83c2ebcd5edc4503644")
            ]
          (dataBytestring,_) = undefined
        toStorage args `shouldBe` dataBytestring
      it "should convert 1 arg with type bytes32" $ do
        let
          args = ValueArrayFixed 1
                  [ SimpleValue (ValueBytes32 (fst $ Base16.decode "adb591795f9e9047f9117163b83c2ebcd5edc4503644d59a98cf911aef0367f8")) ]
          (dataBytestring,_) = Base16.decode "adb591795f9e9047f9117163b83c2ebcd5edc4503644d59a98cf911aef0367f8"
        toStorage args `shouldBe` dataBytestring
      it "should convert 1 arg with type bool" $ do
        let
          args = ValueArrayFixed 1
                  [ SimpleValue (ValueBool True) ]
          (dataBytestring,_) = Base16.decode "0000000000000000000000000000000000000000000000000000000000000001"
        toStorage args `shouldBe` dataBytestring
      it "should convert 1 arg with type string" $ do
        let
          args = ValueArrayFixed 1
                  [ SimpleValue (ValueString "Out the back Pipe punt combo Craig Anderson inner bar glass freshie\
                    \ air drop. Claw hands pumping make the paddle spray Ocean Beach surfing hollow turds in the \
                    \lineup over the reef Mavericks. Taj Burrow crumbly lip flow carves top turn barreling sandbar.\
                    \ Pose on the nose blonde rigs lip pumping good poked the nose, Snapper Rocks.")
                  ]
          (dataBytestring,_) = Base16.decode "0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000014a4f757420746865206261636b20506970652070756e7420636f6d626f20437261696720416e646572736f6e20696e6e65722062617220676c6173732066726573686965206169722064726f702e20436c61772068616e64732070756d70696e67206d616b652074686520706164646c65207370726179204f6365616e2042656163682073757266696e6720686f6c6c6f7720747572647320696e20746865206c696e657570206f766572207468652072656566204d6176657269636b732e2054616a20427572726f77206372756d626c79206c697020666c6f772063617276657320746f70207475726e2062617272656c696e672073616e646261722e20506f7365206f6e20746865206e6f736520626c6f6e64652072696773206c69702070756d70696e6720676f6f6420706f6b656420746865206e6f73652c20536e617070657220526f636b732e00000000000000000000000000000000000000000000"
        toStorage args `shouldBe` dataBytestring

      it "should convert 1 arg with type uint[]" $ do
        let
          args = ValueArrayFixed 1
                  [ ValueArrayDynamic
                    [ SimpleValue $ ValueUInt 1
                    , SimpleValue $ ValueUInt 2
                    , SimpleValue $ ValueUInt 3
                    , SimpleValue $ ValueUInt 4
                    , SimpleValue $ ValueUInt 4
                    , SimpleValue $ ValueUInt 5
                    , SimpleValue $ ValueUInt 66
                    , SimpleValue $ ValueUInt 75
                    , SimpleValue $ ValueUInt 754
                    , SimpleValue $ ValueUInt 98
                    ]
                  ]
          (dataBytestring,_) = Base16.decode "0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000050000000000000000000000000000000000000000000000000000000000000042000000000000000000000000000000000000000000000000000000000000004b00000000000000000000000000000000000000000000000000000000000002f20000000000000000000000000000000000000000000000000000000000000062"
        toStorage args `shouldBe` dataBytestring
      it "should convert 1 arg with type uint[3]" $ do
        let
          args = ValueArrayFixed 1
                  [ ValueArrayFixed 3
                    [ SimpleValue $ ValueUInt 1
                    , SimpleValue $ ValueUInt 2
                    , SimpleValue $ ValueUInt 3
                    ]
                  ]
          (dataBytestring,_) = Base16.decode "000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000003"
        toStorage args `shouldBe` dataBytestring
      it "should convert 1 arg with type enum" $ do
        pendingWith "enum has not been implemented for toStorage"
        let
          args = undefined
          (dataBytestring,_) = undefined
        toStorage args `shouldBe` dataBytestring
