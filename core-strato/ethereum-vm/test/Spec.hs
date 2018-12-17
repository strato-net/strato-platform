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
import           Control.Monad.Logger
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
import           Blockchain.VM.VMState hiding (isRunningTests)
import           Blockchain.VMContext
import           Blockchain.VMOptions()

import           Executable.EVMFlags ()

--noLog :: Loc -> LogSource -> LogLevel -> LogStr -> IO ()
--noLog _ _ _ _ = return ()

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
