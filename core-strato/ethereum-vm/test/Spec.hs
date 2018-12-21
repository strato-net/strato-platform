{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE BangPatterns          #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import           Prelude hiding (print, GT, LT, EQ)
import           ClassyPrelude (print)

import           Test.Hspec
import           HFlags
import           Control.Monad
import           Control.Monad.IO.Class
import           Control.Monad.Logger
import qualified Data.ByteString         as B
import qualified Data.ByteString.Char8   as C8
import qualified Data.ByteString.Base16  as B16
import           Data.Maybe
import qualified Data.Set                as S
import           Data.Either
import qualified Data.Text.Encoding      as Text

import qualified Blockchain.Blockstanbul.BenchmarkLib as BML
import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import qualified Blockchain.Data.Block as BDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.CodeDB
import           Blockchain.Data.Code
import           Blockchain.Output    (printLogMsg)
import           Blockchain.Strato.Model.SHA
import           Blockchain.VM
import           Blockchain.VM.Code
import qualified Blockchain.VM.MutableStack as MS
import           Blockchain.VM.Opcodes
import           Blockchain.VM.VMState hiding (isRunningTests)
import           Blockchain.VMContext
import           Blockchain.VMOptions()

import           Executable.EVMFlags ()

main :: IO ()
main = do
  void $ $initHFlags "Yeah Buddy"
  hspec spec

spec :: Spec
spec = do
  describe "monad transformer over map tests" $ do
    it "stateT get its puts for a map" $ do
      ((result,vmState),_) <- flip runLoggingT printLogMsg $ runTestContextM $ do
        let
          isRunningTests = False
          isHomestead = False
          blockData = BDB.blockBlockData $ BML.makeBlock 0 0
          availableGas = 10000000
          tAddr = (Address 0xfeedbeef)
          newAddress = (Address 0xdeadbeef)
          txValue = 0
          txGasPrice = 10000000
          (i,_) = B16.decode "606060405234610000575b5b5b6101748061001b6000396000f30060606040526000357c0100000000000000000000000000000000000000000000000000000000900463ffffffff168063ec6306431461003e575b610000565b346100005761004b6100d4565b604051808060200182810382528381815181526020019150805190602001908083836000831461009a575b80518252602083111561009a57602082019150602081019050602083039250610076565b505050905090810190601f1680156100c65780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b6020604051908101604052806000815250606060405190810160405280602f81526020017f636f6e7472616374204c6f7474657279207b0a0a0966756e6374696f6e204c6f81526020017f74746572792829207b0a097d0a0a7d000000000000000000000000000000000081525090505b905600a165627a7a72305820b42b9b4bfc4b8e1dca667748b387dad2822afdf716ae22a127a0150b31ce7a960029"
          txInit = Code i

        _ <- create isRunningTests
                    isHomestead
                    S.empty
                    blockData
                    0
                    tAddr
                    tAddr
                    txValue
                    txGasPrice
                    availableGas
                    newAddress
                    txInit
                    (SHA 0)
                    Nothing
                    Nothing
        addressState <- getAddressState newAddress
        liftIO . putStrLn $ show addressState
        code <- fromMaybe C8.empty <$> getCode (addressStateCodeHash addressState)
        liftIO . putStrLn $ show $ B16.encode code
        call isRunningTests
             isHomestead
             True
             S.empty
             blockData
             0
             tAddr
             newAddress
             tAddr
             (fromIntegral txValue)
             (fromIntegral txGasPrice)
             (fst $ B16.decode "ec630643")
             availableGas
             tAddr
             (SHA 0)
             Nothing
             Nothing
      result `shouldSatisfy` isRight
      print $ theTrace vmState
      print $ vmException vmState
      print $ B16.encode "ec630643"
      case returnVal vmState of
        Nothing -> liftIO $ putStrLn "No return value"
        Just code -> do
          print code
          print . fst . B16.decode $ code
          print . Text.decodeUtf8 $ code
          print . C8.takeWhile (/= '\0') . C8.drop 64 $ code
  describe "Mutable Stack" $ do
    it "can push elements" $ do
      s <- MS.empty :: IO (MS.MutableStack Int)
      MS.push s 4 `shouldReturn` True
      MS.push s 7 `shouldReturn` True
      MS.pop s `shouldReturn` Just 7
      MS.pop s `shouldReturn` Just 4
      MS.pop s `shouldReturn` Nothing

    it "has a limit of 1024" $ do
      s <- MS.empty :: IO (MS.MutableStack Int)
      mapM (MS.push s) [1..1024] `shouldReturn` replicate 1024 True
      MS.push s 2048 `shouldReturn` False
      MS.isEmpty s `shouldReturn` False
      replicateM 1024 (MS.pop s) `shouldReturn` map Just [1024,1023..1]
      MS.isEmpty s `shouldReturn` True

    it "dups the correct positions" $ do
      s <- MS.empty :: IO (MS.MutableStack Int)
      mapM (MS.push s) [10,9..0] `shouldReturn` replicate 11 True
      MS.isEmpty s `shouldReturn` False
      let test k = do
            MS.dup s k `shouldReturn` True
            MS.pop s
      test 0 `shouldReturn` Just 0
      test 1 `shouldReturn` Just 1
      test 7 `shouldReturn` Just 7
      test 10 `shouldReturn` Just 10
      MS.dup s 11 `shouldReturn` False
      MS.pop s `shouldReturn` Just 0

    it "swaps the correct positions" $ do
      s <- MS.empty :: IO (MS.MutableStack Int)
      mapM (MS.push s) [50,40..0] `shouldReturn` replicate 6 True
      MS.swap s 0 `shouldReturn` True
      MS.pop s `shouldReturn` Just 10
      MS.pop s `shouldReturn` Just 0
      -- Stack: [50, 40, 30, 20]
      MS.push s 10 `shouldReturn` True
      MS.push s 0 `shouldReturn` True
      -- Stack: [50, 40, 30, 20, 10, 0]
      MS.swap s 4 `shouldReturn` True
      -- Stack: [0, 40, 30, 20, 10, 50]
      MS.pop s `shouldReturn` Just 50
      MS.pop s `shouldReturn` Just 10
      -- Stack: [0, 40, 30, 20]
      MS.swap s 3 `shouldReturn` False
      -- Stack: [0, 40, 30, 20]
      replicateM 4 (MS.pop s) `shouldReturn` map Just [20, 30, 40, 0]

    it "does not underflow on a short swap" $ do
      s <- MS.empty :: IO (MS.MutableStack Int)
      MS.push s 17 `shouldReturn` True
      MS.push s 99 `shouldReturn` True
      MS.swap s 0 `shouldReturn` True
      MS.pop s `shouldReturn` Just 17
      MS.pop s `shouldReturn` Just 99
      MS.pop s `shouldReturn` Nothing

    it "can populate a list" $ do
      s <- MS.empty :: IO (MS.MutableStack Int)
      MS.toList s `shouldReturn` []
      MS.push s 3 `shouldReturn` True
      MS.toList s `shouldReturn` [3]
      MS.push s 4 `shouldReturn` True
      MS.toList s `shouldReturn` [4, 3]
      MS.push s 5 `shouldReturn` True
      MS.toList s `shouldReturn` [5, 4, 3]
      MS.pop s `shouldReturn` Just 5
      MS.toList s `shouldReturn` [4, 3]

  describe "Opcodes" $ do
    it "operations should match opcodes" $ do
      let t n c = toEnum n `shouldBe` c
      t 0x00 STOP
      t 0x01 ADD
      t 0x02 MUL
      t 0x03 SUB
      t 0x04 DIV
      t 0x05 SDIV
      t 0x06 MOD
      t 0x07 SMOD
      t 0x08 ADDMOD
      t 0x09 MULMOD
      t 0x10 LT
      t 0x11 GT
      t 0x12 SLT
      t 0x13 SGT
      t 0x14 EQ
      t 0x15 ISZERO
      t 0x16 AND
      t 0x17 OR
      t 0x18 XOR
      t 0x19 NOT
      t 0x1a BYTE
      t 0x20 SHA3
      t 0x28 UU28
      t 0x29 UU29
      t 0x30 ADDRESS
      t 0x31 BALANCE
      t 0x32 ORIGIN
      t 0x33 CALLER
      t 0x34 CALLVALUE
      t 0x35 CALLDATALOAD
      t 0x36 CALLDATASIZE
      t 0x37 CALLDATACOPY
      t 0x38 CODESIZE
      t 0x39 CODECOPY
      t 0x3a GASPRICE
      t 0x3b EXTCODESIZE
      t 0x3c EXTCODECOPY
      t 0x40 BLOCKHASH
      t 0x41 COINBASE
      t 0x42 TIMESTAMP
      t 0x43 NUMBER
      t 0x44 DIFFICULTY
      t 0x45 GASLIMIT
      t 0x50 POP
      t 0x51 MLOAD
      t 0x52 MSTORE
      t 0x53 MSTORE8
      t 0x54 SLOAD
      t 0x55 SSTORE
      t 0x56 JUMP
      t 0x57 JUMPI
      t 0x58 PC
      t 0x59 MSIZE
      t 0x5a GAS
      t 0x5b JUMPDEST
      t 0x5e UU5E
      t 0x60 PUSH1
      t 0x61 PUSH2
      t 0x62 PUSH3
      t 0x63 PUSH4
      t 0x64 PUSH5
      t 0x65 PUSH6
      t 0x66 PUSH7
      t 0x67 PUSH8
      t 0x68 PUSH9
      t 0x69 PUSH10
      t 0x6a PUSH11
      t 0x6b PUSH12
      t 0x6c PUSH13
      t 0x6d PUSH14
      t 0x6e PUSH15
      t 0x6f PUSH16
      t 0x70 PUSH17
      t 0x71 PUSH18
      t 0x72 PUSH19
      t 0x73 PUSH20
      t 0x74 PUSH21
      t 0x75 PUSH22
      t 0x76 PUSH23
      t 0x77 PUSH24
      t 0x78 PUSH25
      t 0x79 PUSH26
      t 0x7a PUSH27
      t 0x7b PUSH28
      t 0x7c PUSH29
      t 0x7d PUSH30
      t 0x7e PUSH31
      t 0x7f PUSH32
      t 0x80 DUP1
      t 0x81 DUP2
      t 0x82 DUP3
      t 0x83 DUP4
      t 0x84 DUP5
      t 0x85 DUP6
      t 0x86 DUP7
      t 0x87 DUP8
      t 0x88 DUP9
      t 0x89 DUP10
      t 0x8a DUP11
      t 0x8b DUP12
      t 0x8c DUP13
      t 0x8d DUP14
      t 0x8e DUP15
      t 0x8f DUP16
      t 0x90 SWAP1
      t 0x91 SWAP2
      t 0x92 SWAP3
      t 0x93 SWAP4
      t 0x94 SWAP5
      t 0x95 SWAP6
      t 0x96 SWAP7
      t 0x97 SWAP8
      t 0x98 SWAP9
      t 0x99 SWAP10
      t 0x9a SWAP11
      t 0x9b SWAP12
      t 0x9c SWAP13
      t 0x9d SWAP14
      t 0x9e SWAP15
      t 0x9f SWAP16
      t 0xa0 LOG0
      t 0xa1 LOG1
      t 0xa2 LOG2
      t 0xa3 LOG3
      t 0xa4 LOG4
      t 0xa9 UUA9
      t 0xb0 UUB0
      t 0xb5 UUB5
      t 0xc7 UUC7
      t 0xcd UUCD
      t 0xd1 UUD1
      t 0xd3 UUD3
      t 0xd9 UUD9
      t 0xde UUDE
      t 0xe5 UUE5
      t 0xe7 UUE7
      t 0xe9 UUE9
      t 0xf0 CREATE
      t 0xf1 CALL
      t 0xf2 CALLCODE
      t 0xf3 RETURN
      t 0xf4 DELEGATECALL
      t 0xf6 UUF6
      t 0xf7 UUF7
      t 0xfa STATICCALL
      t 0xfd REVERT
      t 0xfe INVALID
      t 0xff SUICIDE

  describe "showCode" $ do
    it "more or less maintains format" $
      let c = Code . B.pack . map (fromIntegral . fromEnum) $ [PUSH3, UUBB, UUCC, UUDD, JUMPDEST, ADD, MUL]
      in showCode c `shouldBe` unlines ["0 62bbccdd PUSH3 [187,204,221] -- 12307677",
                                        "4 5b JUMPDEST",
                                        "5 01 ADD",
                                        "6 02 MUL"]
