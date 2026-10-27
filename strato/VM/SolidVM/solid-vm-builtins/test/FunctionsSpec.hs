{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}

module FunctionsSpec (spec) where

import qualified Blockchain.SolidVM.Builtins.ABI as ABI
import qualified Blockchain.SolidVM.Builtins.ABI.Values as Values
import qualified Blockchain.SolidVM.Builtins.Crypto.Metered as Crypto
import qualified Blockchain.SolidVM.Builtins.Functions as B
import qualified Blockchain.SolidVM.Builtins.Functions.Metered as Charged
import qualified Blockchain.SolidVM.Builtins.Operators as Operators
import qualified Blockchain.SolidVM.Builtins.Operators.Metered as ChargedOperators
import Blockchain.SolidVM.Builtins.Gas
import Blockchain.Strato.Model.Gas (Gas)
import Blockchain.VM.SolidException (SolidException (..))
import Control.Exception (evaluate)
import Control.Monad.IO.Class (MonadIO, liftIO)
import Control.Monad.Trans.Reader (ReaderT, ask, runReaderT)
import Blockchain.Strato.Model.Address (Address)
import qualified Data.ByteString as BS
import qualified Data.Text as T
import qualified Data.Vector as V
import Data.IORef
import Data.Decimal (DecimalRaw (Decimal))
import Data.Time.Clock
import Data.Time.Calendar (fromGregorian)
import Test.Hspec
import SolidVM.Model.Value

newtype Metered a = Metered {runMetered :: ReaderT (IORef [Gas]) IO a}
  deriving (Functor, Applicative, Monad, MonadIO)

instance MonadBuiltinGas Metered where
  chargeBuiltinGas amount = Metered $ do
    charges <- ask
    liftIO $ modifyIORef' charges (++ [amount])

spec :: Spec
spec = do
  describe "shared operator gas" $ do
    it "charges integer operations using the interpreter schedule" $ do
      charges <- newIORef []
      values <- runReaderT (runMetered $ sequence
        [ ChargedOperators.integerAdd 5 7
        , ChargedOperators.integerSubtract 5 7
        , ChargedOperators.integerMultiply 5 7
        , ChargedOperators.integerDivide 35 7
        , ChargedOperators.integerRemainder 35 7
        , ChargedOperators.integerPower 10 100
        , ChargedOperators.integerOr 5 7
        , ChargedOperators.integerAnd 5 7
        , ChargedOperators.integerXor 5 7
        , ChargedOperators.integerShiftLeft 1 65
        , ChargedOperators.integerShiftRight 8 2
        ]) charges
      values `shouldBe` [12,-2,35,5,0,10 ^ (100 :: Integer),7,5,2,2 ^ (65 :: Integer),2]
      readIORef charges `shouldReturn` [2,2,3,2,2,101,2,2,2,4,2]
    it "charges before the underlying operator is evaluated" $ do
      charges <- newIORef []
      (runReaderT (runMetered $ ChargedOperators.integerDivide 1 0) charges >>= evaluate)
        `shouldThrow` (== DivideByZero "0")
      readIORef charges `shouldReturn` [2]
    it "uses the shared zero-divisor error for modular builtins" $ do
      evaluate (B.addmod 1 2 0) `shouldThrow` (== DivideByZero "0")
      evaluate (B.mulmod 1 2 0) `shouldThrow` (== DivideByZero "0")
    it "raises the shared error for decimal zero divisors and negative powers" $ do
      charges <- newIORef []
      runReaderT (runMetered $ ChargedOperators.decimalDivide 1 0) charges
        `shouldThrow` (== DivideByZero "0")
      runReaderT (runMetered $ ChargedOperators.integerPower 2 (-1)) charges
        `shouldThrow` (== ArithmeticException "negative exponent" "-1")
    it "retains the different ordinary and compound division prices" $ do
      charges <- newIORef []
      values <- runReaderT (runMetered $ sequence
        [ ChargedOperators.integerDivide 1 (2 ^ (256 :: Integer))
        , ChargedOperators.integerDivideAssign 1 (2 ^ (256 :: Integer))
        ]) charges
      values `shouldBe` [0,0]
      readIORef charges `shouldReturn` [2,3]
    it "prices decimal operands using their original precision and representation" $ do
      charges <- newIORef []
      let a = Decimal 0 1
          b = Decimal 32 (2 ^ (256 :: Integer))
      values <- runReaderT (runMetered $ sequence
        [ ChargedOperators.decimalDivide a b
        , ChargedOperators.integerDecimalDivide 1 b
        , ChargedOperators.integerDecimalDivideAssign 1 b
        ]) charges
      values `shouldBe` [Operators.decimalDivide a b, Operators.integerDecimalDivide 1 b, Operators.integerDecimalDivide 1 b]
      readIORef charges `shouldReturn` [4,3,4]
    it "charges concatenation and contract conversions once" $ do
      charges <- newIORef []
      runReaderT (runMetered $ do
        _ <- ChargedOperators.stringAdd (replicate 31 'a') "b"
        _ <- ChargedOperators.bytesAdd (BS.replicate 32 1) (BS.singleton 2)
        _ <- Charged.stringConcat [replicate 31 'a', "b"]
        _ <- Charged.contractCast (7 :: Integer)
        Charged.contractCode ["one", "two"]) charges `shouldReturn` "one\ntwo\n"
      readIORef charges `shouldReturn` [2,2,2,500,1000]

  describe "builtin conversions and encoding" $ do
    it "preserves odd-length hex input and lowercase normalization" $ do
      B.b16decode "abc" `shouldBe` BS.pack [10, 188]
      B.normalizeHex "0xAbC" `shouldBe` "0x0abc"
    it "preserves the invalid hex error payload" $
      evaluate (B.b16decode "zz") `shouldThrow` (== InvalidArguments "b16decode: invalid hex string" "\"zz\"")
    it "preserves base64 padding and URL-safe unpadded output" $ do
      B.base64encode (BS.pack [251, 255]) `shouldBe` "+/8="
      B.base64urlencode (BS.pack [251, 255]) `shouldBe` "-_8"
    it "preserves the SHA-256 digest" $
      B.b16encode (B.sha256 "abc") `shouldBe` "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"

  describe "ecrecover hash inputs" $ do
    it "preserves the existing byte representation of each input type" $ do
      let recover input = B.ecrecover input 27 1 1
      recover (T.replicate 64 "0") `shouldBe` recover (BS.replicate 32 0)
      recover (T.replicate 32 "z") `shouldBe` recover (BS.replicate 32 122)
      recover (1 :: Integer) `shouldBe` recover (BS.singleton 1)
      recover (1 :: Address) `shouldBe` recover (BS.replicate 19 0 <> BS.singleton 1)
      recover () `shouldBe` recover BS.empty

  describe "ABI layout and malformed data" $ do
    it "encodes and decodes SolidVM dynamic values through the shared package" $ do
      encoded <- Values.abiEncode [SInteger 7, SString "abc"]
      encoded `shouldBe` ABI.abiEncode [(False, ABI.encodeUint256 7), (True, ABI.encodeDynamicBytes "abc")]
      case Values.abiDecode encoded [SString "uint", SString "string"] of
        STuple values -> traverse weakGetVar (V.toList values) `shouldReturn` [SInteger 7, SString "abc"]
        value -> expectationFailure $ show value
    it "dereferences mutable array elements for standard and packed encoding" $ do
      element <- createVar $ SInteger 7
      let array = SArray $ V.singleton element
      Values.abiEncode [array] `shouldReturn` ABI.encodeUint256 32 <> ABI.encodeUint256 1 <> ABI.encodeUint256 7
      Values.abiEncodePacked [array] `shouldReturn` ABI.encodeUint256 7
    it "preserves head offsets, byte lengths, and right padding" $ do
      ABI.abiEncode [(False, ABI.encodeUint256 7), (True, ABI.encodeDynamicBytes "abc")]
        `shouldBe` ABI.encodeUint256 7 <> ABI.encodeUint256 64 <> ABI.encodeUint256 3 <> "abc" <> BS.replicate 29 0
    it "preserves signed decoding" $
      ABI.decodeInt 256 (ABI.encodeInt256 (-2)) 0 `shouldBe` (-2)
    it "clamps malformed array lengths to available element slots" $ do
      let bs = ABI.encodeUint256 32 <> ABI.encodeUint256 (2 ^ (255 :: Integer)) <> ABI.encodeUint256 7
      ABI.decodeArray ABI.decodeUint bs 0 `shouldBe` [7]
    it "preserves unknown decode types as the supplied null value" $
      ABI.abiDecode (\_ bs offset -> ABI.decodeUint bs offset) (-1)
        (ABI.encodeUint256 7 <> ABI.encodeUint256 9) [Nothing, Just "uint"] `shouldBe` [-1, 9]

  describe "shared metered crypto builtins" $ do
    it "charges the modular exponentiation cost and returns the result" $ do
      charges <- newIORef []
      runReaderT (runMetered $ Crypto.modExp 2 10 1000) charges `shouldReturn` 24
      readIORef charges `shouldReturn` [gasModExp]
    it "charges before forcing malformed integer arguments" $ do
      charges <- newIORef []
      runReaderT (runMetered $ Crypto.modExp (error "invalid input") 10 1000) charges `shouldThrow` anyErrorCall
      readIORef charges `shouldReturn` [gasModExp]
    it "charges incomplete MSM terms before rejecting their arity" $ do
      charges <- newIORef []
      runReaderT (runMetered $ Crypto.bls12381G1MsmInts [1,2]) charges `shouldThrow`
        (== InvalidArguments "bls12381G1Msm: expected a multiple of 3 integer args (x, y, k per term)" "[1,2]")
      readIORef charges `shouldReturn` [gasBlsG1MsmPerTerm]
    it "preserves BLS byte-input validation after charging" $ do
      charges <- newIORef []
      runReaderT (runMetered $ Crypto.decompressG1 "x") charges `shouldThrow`
        (\e -> case e of InvalidArguments message _ -> "bls12381DecompressG1: " `T.isPrefixOf` T.pack message; _ -> False)
      readIORef charges `shouldReturn` [gasBlsDecompressG1]

  describe "stateful builtin operation order" $ do
    it "clears code, pays, and purges storage even when payment returns false" $ do
      events <- newIORef ([] :: [String])
      let record event = modifyIORef' events (++ [event])
      result <- B.selfdestruct (record "address" >> pure (1 :: Int))
        (\_ -> record "balance" >> pure 5)
        (\_ -> record "clear")
        (\_ _ _ -> record "pay" >> pure False)
        (\_ -> record "purge") 2
      result `shouldBe` False
      readIORef events `shouldReturn` ["address", "balance", "clear", "pay", "purge"]
    it "rejects an empty create input before compilation or allocation" $ do
      compiled <- newIORef False
      B.create (pure (0 :: Int)) (writeIORef compiled True) (\_ -> pure ()) (\_ _ -> pure 1) "" "source"
        `shouldReturn` 0
      readIORef compiled `shouldReturn` False
    it "validates blockhash before querying state" $ do
      queried <- newIORef False
      B.blockhash (\_ -> writeIORef queried True >> pure Nothing) (-1)
        `shouldThrow` (== InvalidArguments "blockhash() only accepts arguments greater than or equal to 0" "[-1]")
      readIORef queried `shouldReturn` False
    it "preserves the minimum one-second fastForward and signed block increment" $ do
      let timestamp = UTCTime (fromGregorian 2026 1 1) 0
      result <- newIORef (timestamp, 10)
      B.fastForward True (error "unexpected test guard") timestamp 10 (-3) (-2)
        (\t n -> writeIORef result (t, n))
      readIORef result `shouldReturn` (addUTCTime 1 timestamp, 8)
    it "validates a P-256 digest before decoding the public key or signature" $
      B.verifyP256 "short" (error "public key evaluated") (error "signature evaluated")
        `shouldThrow` (== InvalidArguments "Could not decode hash from string" "\"short\"")
