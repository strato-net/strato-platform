{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE BangPatterns          #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import           Prelude hiding (print)
import           ClassyPrelude (print)

import           Test.Hspec
import           HFlags
import           Control.Monad
import           Control.Monad.IO.Class
import qualified Data.ByteString         as B
import qualified Data.ByteString.Char8   as C8
import qualified Data.ByteString.Base16  as B16
import qualified Data.ByteString.Short   as BSS
import           Data.Maybe
import qualified Data.Set                as S
import qualified Data.Text.Encoding      as Text

import qualified Blockchain.Blockstanbul.BenchmarkLib as BML
import           Blockchain.Data.Address
import           Blockchain.Data.AddressStateDB
import qualified Blockchain.Data.Block as BDB
import           Blockchain.DB.MemAddressStateDB
import           Blockchain.DB.CodeDB
import           Blockchain.Data.Code
import           Blockchain.Data.ExecResults
import           Blockchain.EVM
import qualified Blockchain.EVM.MutableStack as MS
import           Blockchain.EVM.Opcodes
import           Blockchain.Output
import           Blockchain.Strato.Model.SHA
import           Blockchain.VMContext
import           Blockchain.VMOptions()

import           Executable.EVMFlags ()

--noLog :: Loc -> LogSource -> LogLevel -> LogStr -> IO ()
--noLog _ _ _ _ = return ()

{-# NOINLINE exampleCode #-}
exampleCode :: B.ByteString
exampleCode = B.pack $ [0..255]

main :: IO ()
main = do
  void $ $initHFlags "Yeah Buddy"
  hspec spec

spec :: Spec
spec = do
  describe "monad transformer over map tests" $ do
    it "stateT get its puts for a map" $ do
      (execResults,_) <- runLoggingT $ runTestContextM $ do
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
        code <- getEVMCode $
                case addressStateCodeHash addressState of
                  EVMCode x -> x
                  _ -> error "vm-runner tests only support EVMCode"
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
      erException execResults `shouldSatisfy` isNothing
      print $ erTrace execResults
      print $ erException execResults
      print $ B16.encode "ec630643"
      case erReturnVal execResults of
        Nothing -> liftIO $ putStrLn "No return value"
        Just short -> do
          let code = BSS.fromShort short
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

  describe "Code" $ do
    describe "extract byte" $ do
      it "can extract 1 byte" $ do
         fastExtractByte exampleCode 0 `shouldBe` defaultExtract exampleCode 0 1
         fastExtractByte exampleCode 1 `shouldBe` defaultExtract exampleCode 1 1
         fastExtractByte exampleCode 2 `shouldBe` defaultExtract exampleCode 2 1
         map (fastExtractByte exampleCode) [0..255] `shouldBe` map (\x -> defaultExtract exampleCode x 1) [0..255]

    describe "extract single word" $ do
      it "can extract 3 bytes" $ do
        forM_ [0, 1, 7, 128] $ \n ->
          fastExtractSingle exampleCode n 3 `shouldBe` defaultExtract exampleCode n 3
      it "can extract 7 bytes" $ do
        forM_ [0, 1, 0xbb] $ \n ->
          fastExtractSingle exampleCode n 7 `shouldBe` defaultExtract exampleCode n 7

    describe "extract four words" $ do
      it "can extract 25 bytes" $ do
        fastExtractQuad exampleCode 1 25 `shouldBe` defaultExtract exampleCode 1 25
      it "can extract 31 bytes" $ do
        fastExtractQuad exampleCode 0 31 `shouldBe` defaultExtract exampleCode 0 31
        fastExtractQuad exampleCode 1 31 `shouldBe` defaultExtract exampleCode 1 31
        fastExtractQuad exampleCode 2 31 `shouldBe` defaultExtract exampleCode 2 31
      it "can extract 32 bytes" $ do
        fastExtractQuad exampleCode 0 32 `shouldBe`  defaultExtract exampleCode 0 32
        fastExtractQuad exampleCode 1 32 `shouldBe`  defaultExtract exampleCode 1 32
        fastExtractQuad exampleCode 2 32 `shouldBe`  defaultExtract exampleCode 2 32
        fastExtractQuad exampleCode 64 32 `shouldBe` defaultExtract exampleCode 64 32
