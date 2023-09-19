{-# LANGUAGE OverloadedStrings #-}

module BlockApps.Solidity.StorageSpec where

import BlockApps.Solidity.Storage
import BlockApps.Solidity.Type
import BlockApps.Solidity.Value
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import qualified Data.ByteString.Base16 as Base16
import Data.Maybe (fromJust, isJust)
import qualified LabeledError
import Test.Hspec

{-# ANN module ("HLint: ignore Redundant do" :: String) #-}

{-# ANN module ("HLint: ignore Reduce duplication" :: String) #-}

spec :: Spec
spec = do
  describe "toStorage" $ do
    describe "convert an array of arguments into a bytestring" $ do
      context "official Ethereum ABI Tests: found at https://github.com/ethereum/tests/blob/develop/ABITests/basic_abi_tests.json" $ do
        it "should convert 4 args with types: uint256, uint32[], bytes10, and bytes" $ do
          let args =
                ValueArrayFixed
                  4
                  [ SimpleValue (valueUInt256 291),
                    ValueArrayDynamic $
                      tosparse
                        [ SimpleValue (ValueInt False (Just 4) 1110),
                          SimpleValue (ValueInt False (Just 4) 1929)
                        ],
                    SimpleValue (ValueBytes (Just 10) "1234567890"),
                    SimpleValue (valueBytes "Hello, world!")
                  ]
              dataBytestring = LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "00000000000000000000000000000000000000000000000000000000000001230000000000000000000000000000000000000000000000000000000000000080313233343536373839300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000004560000000000000000000000000000000000000000000000000000000000000789000000000000000000000000000000000000000000000000000000000000000d48656c6c6f2c20776f726c642100000000000000000000000000000000000000"
          toStorage args `shouldBe` dataBytestring
        it "should convert 1 arg with type uint256" $ do
          let args =
                ValueArrayFixed
                  1
                  [SimpleValue (valueUInt256 98127491)]
              dataBytestring = LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "0000000000000000000000000000000000000000000000000000000005d94e83"
          toStorage args `shouldBe` dataBytestring
        it "should convert 2 arg with type uint256, addresss" $ do
          let args =
                ValueArrayFixed
                  2
                  [SimpleValue (valueInt256 324124), SimpleValue (ValueAccount $ unspecifiedChain (Address 0xcd2a3d9f938e13cd947ec05abc7fe734df8dd826))]
              dataBytestring = LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "000000000000000000000000000000000000000000000000000000000004f21c000000000000000000000000cd2a3d9f938e13cd947ec05abc7fe734df8dd826"
          toStorage args `shouldBe` dataBytestring
      it "should convert 1 arg with type uint" $ do
        let args =
              ValueArrayFixed
                1
                [SimpleValue (valueUInt 3)]
            dataBytestring = LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "0000000000000000000000000000000000000000000000000000000000000003"
        toStorage args `shouldBe` dataBytestring
      it "should convert 1 arg with type int" $ do
        let args =
              ValueArrayFixed
                1
                [SimpleValue (valueInt (-1))]
            dataBytestring = LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
        toStorage args `shouldBe` dataBytestring
      it "should convert 1 arg with type address" $ do
        let args =
              ValueArrayFixed
                1
                [SimpleValue (ValueAccount $ unspecifiedChain (Address 0xdeadbeef))]
            dataBytestring = LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "00000000000000000000000000000000000000000000000000000000deadbeef"
        toStorage args `shouldBe` dataBytestring
      it "should convert 1 arg with type bytes" $ do
        pendingWith "Need to find a correct bytestring to compare against, blockapps-js returns empty-string"
        let args =
              ValueArrayFixed
                1
                [ SimpleValue $
                    valueBytes
                      (LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "adb591795f9e9047f9117163b83c2ebcd5edc4503644d59a98cf911aef0367f8adb591795f9e9047f9117163b83c2ebcd5edc4503644")
                ]
            (dataBytestring, _) = undefined
        toStorage args `shouldBe` dataBytestring
      it "should convert 1 arg with type bytes32" $ do
        let args =
              ValueArrayFixed
                1
                [SimpleValue (ValueBytes (Just 32) (LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "adb591795f9e9047f9117163b83c2ebcd5edc4503644d59a98cf911aef0367f8"))]
            dataBytestring = LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "adb591795f9e9047f9117163b83c2ebcd5edc4503644d59a98cf911aef0367f8"
        toStorage args `shouldBe` dataBytestring
      it "should convert 1 arg with type bool" $ do
        let args =
              ValueArrayFixed
                1
                [SimpleValue (ValueBool True)]
            dataBytestring = LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "0000000000000000000000000000000000000000000000000000000000000001"
        toStorage args `shouldBe` dataBytestring
      it "should convert 1 arg with type string" $ do
        let args =
              ValueArrayFixed
                1
                [ SimpleValue
                    ( ValueString
                        "Out the back Pipe punt combo Craig Anderson inner bar glass freshie\
                        \ air drop. Claw hands pumping make the paddle spray Ocean Beach surfing hollow turds in the \
                        \lineup over the reef Mavericks. Taj Burrow crumbly lip flow carves top turn barreling sandbar.\
                        \ Pose on the nose blonde rigs lip pumping good poked the nose, Snapper Rocks."
                    )
                ]
            dataBytestring = LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000014a4f757420746865206261636b20506970652070756e7420636f6d626f20437261696720416e646572736f6e20696e6e65722062617220676c6173732066726573686965206169722064726f702e20436c61772068616e64732070756d70696e67206d616b652074686520706164646c65207370726179204f6365616e2042656163682073757266696e6720686f6c6c6f7720747572647320696e20746865206c696e657570206f766572207468652072656566204d6176657269636b732e2054616a20427572726f77206372756d626c79206c697020666c6f772063617276657320746f70207475726e2062617272656c696e672073616e646261722e20506f7365206f6e20746865206e6f736520626c6f6e64652072696773206c69702070756d70696e6720676f6f6420706f6b656420746865206e6f73652c20536e617070657220526f636b732e00000000000000000000000000000000000000000000"
        toStorage args `shouldBe` dataBytestring

      it "should convert 1 arg with type uint[]" $ do
        let args =
              ValueArrayFixed
                1
                [ ValueArrayDynamic $
                    tosparse
                      [ SimpleValue $ valueUInt 1,
                        SimpleValue $ valueUInt 2,
                        SimpleValue $ valueUInt 3,
                        SimpleValue $ valueUInt 4,
                        SimpleValue $ valueUInt 4,
                        SimpleValue $ valueUInt 5,
                        SimpleValue $ valueUInt 66,
                        SimpleValue $ valueUInt 75,
                        SimpleValue $ valueUInt 754,
                        SimpleValue $ valueUInt 98
                      ]
                ]
            dataBytestring = LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000050000000000000000000000000000000000000000000000000000000000000042000000000000000000000000000000000000000000000000000000000000004b00000000000000000000000000000000000000000000000000000000000002f20000000000000000000000000000000000000000000000000000000000000062"
        toStorage args `shouldBe` dataBytestring
      it "should convert 1 arg with type uint[3]" $ do
        let args =
              ValueArrayFixed
                1
                [ ValueArrayFixed
                    3
                    [ SimpleValue $ valueUInt 1,
                      SimpleValue $ valueUInt 2,
                      SimpleValue $ valueUInt 3
                    ]
                ]
            dataBytestring = LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000003"
        toStorage args `shouldBe` dataBytestring
      it "should convert 5args address, address, bytes32, bytes32[], string" $ do
        let args =
              ValueArrayFixed
                5
                [ SimpleValue . ValueAccount . unspecifiedChain . fromJust . stringAddress $ "fdb2eea0003ec6de4f8bc1fe63307b730d5b7e62",
                  SimpleValue . ValueAccount . unspecifiedChain . fromJust . stringAddress $ "fdb2eea0003ec6de4f8bc1fe63307b730d5b7e62",
                  SimpleValue . ValueBytes (Just 32) . LabeledError.b16Decode "evm-solidity/StorageSpec.hs" $ "81a76550480e6e3d9a4df17b9f3683b66ceda988390a73c1446c427173bf6a89",
                  ValueArrayDynamic $
                    tosparse
                      [ SimpleValue . ValueBytes (Just 32) . LabeledError.b16Decode "evm-solidity/StorageSpec.hs" $
                          "81a76550480e6e3d9a4df17b9f3683b66ceda988390a73c1446c427173bf6a89",
                        SimpleValue . ValueBytes (Just 32) . LabeledError.b16Decode "evm-solidity/StorageSpec.hs" $
                          "81a76550480e6e3d9a4df17b9f3683b66ceda988390a73c1446c427173bf6a89"
                      ],
                  SimpleValue . ValueString $ "Account Data should be able to be as long as you want ideally 12343432442431"
                ]
            dataBytestring = LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "000000000000000000000000fdb2eea0003ec6de4f8bc1fe63307b730d5b7e62000000000000000000000000fdb2eea0003ec6de4f8bc1fe63307b730d5b7e6281a76550480e6e3d9a4df17b9f3683b66ceda988390a73c1446c427173bf6a8900000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000281a76550480e6e3d9a4df17b9f3683b66ceda988390a73c1446c427173bf6a8981a76550480e6e3d9a4df17b9f3683b66ceda988390a73c1446c427173bf6a89000000000000000000000000000000000000000000000000000000000000004c4163636f756e7420446174612073686f756c642062652061626c6520746f206265206173206c6f6e6720617320796f752077616e7420696465616c6c792031323334333433323434323433310000000000000000000000000000000000000000"
        print . Base16.encode . toStorage $ args
        toStorage args `shouldBe` dataBytestring
      it "should convert 1 arg with type enum" $ do
        pendingWith "enum has not been implemented for toStorage"
        let args = undefined
            (dataBytestring, _) = undefined
        toStorage args `shouldBe` dataBytestring
  describe "bytestringToValues and toStorage" $ do
    it "should decode and encode: uint" $ do
      let types = [SimpleType typeUInt]
          dataBytestring = LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "0000000000000000000000000000000000000000000000000000000000000003"
          mBytes = toStorage . ValueArrayFixed 1 <$> bytestringToValues dataBytestring types
      mBytes `shouldSatisfy` isJust
      let Just bytes' = mBytes
      dataBytestring `shouldBe` bytes'
    it "should decode and encode: int" $ do
      let types = [SimpleType typeInt]
          dataBytestring = LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0ff"
          mBytes = toStorage . ValueArrayFixed 1 <$> bytestringToValues dataBytestring types
      mBytes `shouldSatisfy` isJust
      let Just bytes' = mBytes
      dataBytestring `shouldBe` bytes'
    it "should decode and encode: address" $ do
      let types = [SimpleType TypeAccount]
          dataBytestring = LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "00000000000000000000000000000000000000000000000000000000deadbeef"
          mBytes = toStorage . ValueArrayFixed 1 <$> bytestringToValues dataBytestring types
      mBytes `shouldSatisfy` isJust
      let Just bytes' = mBytes
      dataBytestring `shouldBe` bytes'
    it "should decode and encode: uint, int, uint[], bytes" $ do
      let types =
            [ SimpleType typeUInt,
              SimpleType typeInt,
              TypeArrayDynamic (SimpleType typeUInt),
              SimpleType typeBytes
            ]
          dataBytestring = LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000005b303132333435363738393132333435363738393132333435363738393132333435363738393132333435363738393132333435363738393132333435363738393132333435363738393132333435363738393132333435363738390000000000"
          mBytes = toStorage . ValueArrayFixed 4 <$> bytestringToValues dataBytestring types
      mBytes `shouldSatisfy` isJust
      let Just bytes' = mBytes
      dataBytestring `shouldBe` bytes'
    it "should decode and encode: uint256, uint32[], bytes10, and bytes" $ do
      let types =
            [ SimpleType typeUInt256,
              TypeArrayDynamic (SimpleType $ TypeInt False $ Just 4),
              SimpleType (TypeBytes $ Just 10),
              SimpleType typeBytes
            ]
          dataBytestring = LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "00000000000000000000000000000000000000000000000000000000000001230000000000000000000000000000000000000000000000000000000000000080313233343536373839300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000004560000000000000000000000000000000000000000000000000000000000000789000000000000000000000000000000000000000000000000000000000000000d48656c6c6f2c20776f726c642100000000000000000000000000000000000000"
          -- mBytes = toStorage <$> ValueArrayFixed 4 <$> (bytestringToValues dataBytestring types)
          mBytes = toStorage . ValueArrayFixed 4 <$> bytestringToValues dataBytestring types
      mBytes `shouldSatisfy` isJust
      let Just bytes' = mBytes
      dataBytestring `shouldBe` bytes'
    it "should decode and encode: bool" $ do
      let types =
            [SimpleType TypeBool]
          dataBytestring = LabeledError.b16Decode "evm-solidity/StorageSpec.hs" "0000000000000000000000000000000000000000000000000000000000000001"
          mBytes = toStorage . ValueArrayFixed 4 <$> bytestringToValues dataBytestring types
      mBytes `shouldSatisfy` isJust
      let Just bytes' = mBytes
      dataBytestring `shouldBe` bytes'
