{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}

module FunctionsSpec (spec) where

import Blockchain.SolidVM.GasInfo (MonadBuiltinGas (..))
import BlockApps.Logging (runLogging)
import Blockchain.Data.AddressStateDB
import qualified Blockchain.Data.BlockHeader as BlockHeader
import Blockchain.SolidVM.Execution
import qualified Blockchain.SolidVM.Environment as Env
import Blockchain.SolidVM.GasInfo (GasInfo (..))
import Blockchain.SolidVM.Builtins.Size.Values (ValueArguments (..))
import Blockchain.SolidVM.SM
import Blockchain.VMContext (runMemContextM)
import Control.Monad.Composable.Base (runEff)
import qualified Control.Monad.Composable.StateDB as MP
import qualified Control.Monad.Change.Alter as A
import Data.Default (def)
import qualified Data.Map as M
import Blockchain.Strato.Model.Keccak256 (emptyHash, unsafeCreateKeccak256FromWord256)
import qualified Blockchain.SolidVM.Builtins.ABI as ABI
import qualified Blockchain.SolidVM.Builtins.ABI.Values as Values
import qualified Blockchain.SolidVM.Builtins.ABI.Values.Metered as MeteredABI
import qualified Blockchain.SolidVM.Builtins.Crypto.Metered as Crypto
import qualified Blockchain.SolidVM.Builtins.Functions as B
import qualified Blockchain.SolidVM.Builtins.Functions.Metered as Charged
import qualified Blockchain.SolidVM.Builtins.Operators as Operators
import qualified Blockchain.SolidVM.Builtins.Operators.Metered as ChargedOperators
import qualified Blockchain.SolidVM.Builtins.Operations.Metered as Operations
import qualified Blockchain.SolidVM.Builtins.Casts.Metered as Casts
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

data TestEngine

instance MonadContractCreation TestEngine SM where
  prepareContractSource _ = error "unexpected compilation"
  runContractConstructor _ _ _ _ _ _ = error "unexpected constructor"

runBuiltin :: Bool -> SM a -> IO (Env.Environment, Either SolidException a)
runBuiltin testing body = fst <$> (runEff . runLogging . runMemContextM (const $ pure Nothing) Nothing $
  runSM Nothing environment (GasInfo 100000 0 100000 "") body)
  where
    header = BlockHeader.BlockHeader emptyHash emptyHash 0 MP.emptyTriePtr MP.emptyTriePtr MP.emptyTriePtr
      "" 0 10 100000 0 (UTCTime (fromGregorian 2026 1 1) 0) "" emptyHash 0
    environment = Env.Environment 0 0 0 header emptyHash Nothing Nothing testing Nothing

spec :: Spec
spec = do
  describe "operation gas" $ do
    it "prices arguments and storage by words, with flat local writes" $ do
      charges <- newIORef []
      runReaderT (runMetered $ do
        Operations.functionEntry (ValueArguments [SBytes BS.empty, SBytes (BS.replicate 1 0), SBytes (BS.replicate 32 0), SBytes (BS.replicate 33 0)])
        Operations.localWrite
        value <- Operations.storageRead id (pure 33)
        Operations.storageWrite value
        Operations.allocate 3) charges
      readIORef charges `shouldReturn` [9,1,5,2,22,4]
    it "charges heterogeneous typed arguments using the same rules as Value arguments" $ do
      charges <- newIORef []
      runReaderT (runMetered $ do
        Operations.functionEntry ((42 :: Integer), (True, ((T.replicate 33 "x"), ())))
        Operations.functionEntry (ValueArguments [SInteger 42, SBool True, SString (replicate 33 'x')])
        Operations.functionEntry (("a" :: T.Text), (("b" :: T.Text), ()))
        Operations.functionEntry ()) charges
      readIORef charges `shouldReturn` [9,9,7,5]
    it "meters previously free hashing, encoding, casts, and control builtins" $ do
      charges <- newIORef []
      runReaderT (runMetered $ do
        _ <- Charged.keccak256 (BS.replicate 1024 0)
        _ <- Charged.sha256 BS.empty
        _ <- Charged.b16encode "abc"
        _ <- Casts.int ("10" :: T.Text)
        _ <- Charged.identity True
        _ <- Charged.variadic [1 :: Integer, 2]
        Charged.require True Nothing
        Charged.assert True) charges
      readIORef charges `shouldReturn` [33,1,2,2,1,3,1,1]
    it "charges before throwing cast failures without an error transformer" $ do
      charges <- newIORef []
      runReaderT (runMetered $ Casts.int ("hello" :: T.Text)) charges
        `shouldThrow` (== InvalidArguments "invalid hexadecimal integer" (show ["\"hello\"" :: T.Text]))
      readIORef charges `shouldReturn` [2]
    it "charges only the integer input for the fixed-width bytes cast" $ do
      charges <- newIORef []
      runReaderT (runMetered $ Casts.bytes32 1) charges `shouldReturn` (BS.replicate 31 0 <> BS.singleton 1)
      readIORef charges `shouldReturn` [2]
    it "charges the address input word for payable conversion" $ do
      charges <- newIORef []
      runReaderT (runMetered $ Charged.payable (1 :: Address)) charges `shouldReturn` (1,True)
      readIORef charges `shouldReturn` [2]
    it "charges before evaluating the operation body" $ do
      charges <- newIORef []
      (runReaderT (runMetered $ Operations.invoke 32 (liftIO (evaluate (error "not executed" :: ())))) charges)
        `shouldThrow` anyErrorCall
      readIORef charges `shouldReturn` [2]
    it "never refunds gas for negative operation sizes" $ do
      charges <- newIORef []
      runReaderT (runMetered (chargeOperation (-1000))) charges
      readIORef charges `shouldReturn` [1]

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
    it "charges typed inputs before encoding and preserves standard and packed bytes" $ do
      charges <- newIORef []
      let args = ((7 :: Integer), (("abc" :: T.Text), ()))
          fields = [(False, ABI.encodeUint256 7), (True, ABI.encodeDynamicBytes "abc")]
      standard <- runReaderT (runMetered $ MeteredABI.encodeArguments False args (pure fields)) charges
      standard `shouldBe` ABI.abiEncode fields
      packed <- runReaderT (runMetered $ MeteredABI.encodeArguments True args (pure fields)) charges
      packed `shouldBe` ABI.abiEncodePacked (map snd fields)
      readIORef charges `shouldReturn` [3,3]
      runReaderT (runMetered $ MeteredABI.encodeArguments False args (liftIO $ evaluate $ error "encoding failed")) charges
        `shouldThrow` anyErrorCall
      readIORef charges `shouldReturn` [3,3,3]
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
    it "charges at least one gas unit for empty MSM inputs" $ do
      charges <- newIORef []
      runReaderT (runMetered $ Crypto.bls12381G1MsmInts []) charges `shouldReturn` (0,0)
      runReaderT (runMetered $ Crypto.bls12381G2MsmInts []) charges `shouldReturn` ((0,0),(0,0))
      readIORef charges `shouldReturn` [1,1]
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
    it "clears code and transfers the balance through the SolidVM state" $ do
      (_, result) <- runBuiltin False $ withCallInfo 1 1 def "test" emptyHash def M.empty False False $ do
        A.adjustWithDefault_ (A.Proxy @AddressState) (1 :: Address) $ \state -> pure state {addressStateBalance = 5}
        sent <- Charged.selfdestruct 2
        sender <- A.lookupWithDefault (A.Proxy @AddressState) (1 :: Address)
        recipient <- A.lookupWithDefault (A.Proxy @AddressState) (2 :: Address)
        gas <- getGasInfo
        pure (sent, addressStateBalance sender, addressStateBalance recipient, addressStateCodeHash sender, _gasUsed gas)
      result `shouldBe` Right (True, 0, 5, SolidVMCode "Code_0" (unsafeCreateKeccak256FromWord256 0), 5000)
    it "charges before accessing a contract's state" $ do
      (_, result) <- runBuiltin False $ do
        chargeBuiltinGas 99999
        Charged.selfdestruct 2
      case result of
        Left TooMuchGas{} -> pure ()
        other -> expectationFailure $ show other
    it "rejects an empty create input before compilation or allocation" $ do
      (_, result) <- runBuiltin False $ B.create @TestEngine "" "source" []
      result `shouldBe` Left (InvalidArguments
        "The contract name and src arguments for the create function should not be empty" "[SString \"\",SString \"source\"]")
    it "validates blockhash before querying state" $ do
      (_, result) <- runBuiltin False $ B.blockhash (-1)
      result `shouldBe` Left (InvalidArguments "blockhash() only accepts arguments greater than or equal to 0" "[-1]")
    it "preserves the minimum one-second fastForward and signed block increment" $ do
      (environment, result) <- runBuiltin True $ B.fastForward (-3) (-2)
      result `shouldBe` Right ()
      let header = Env.blockHeader environment
      BlockHeader.timestamp header `shouldBe` addUTCTime 1 (UTCTime (fromGregorian 2026 1 1) 0)
      BlockHeader.number header `shouldBe` 8
    it "rejects changes to the block outside tests" $ do
      (_, result) <- runBuiltin False $ B.fastForward 5 1
      result `shouldBe` Left (InvalidArguments "fastForward can only be called during testing" "[SInteger 5]")
    it "validates a P-256 digest before decoding the public key or signature" $
      B.verifyP256 "short" (error "public key evaluated") (error "signature evaluated")
        `shouldThrow` (== InvalidArguments "Could not decode hash from string" "\"short\"")
