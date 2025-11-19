{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# OPTIONS_GHC -fno-warn-overlapping-patterns #-}

module BlockSpec (spec, main) where

import Blockchain.Data.BlockHeader
import Blockchain.Data.Enode
import Blockchain.Data.RLP
import Blockchain.Data.Transaction
import Blockchain.Model.JsonBlock
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Control.Monad
import qualified Crypto.Secp256k1 as SEC
import Data.Aeson as Ae
import Data.Aeson.Diff
import qualified Data.Aeson.KeyMap as KM
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy.Char8 as C8
import qualified Data.ByteString.Short as BSS
import Data.Map.Strict (Map)
import Data.Maybe (fromMaybe)
import qualified Data.Text as T
import qualified Data.Text.Encoding as T
import qualified Data.Vector as V
import Data.Word
import qualified LabeledError
import Test.Hspec
import Test.Hspec.QuickCheck
import Test.Hspec.Runner
import Test.QuickCheck
import Web.FormUrlEncoded
import Web.HttpApiData

--import Control.Applicative (liftA2)
--import Text.Read hiding (String)

predicate :: Path -> Bool
predicate (_, _) = True
predicate _ = False

main :: IO ()
main = hspecWith (configAddFilter predicate defaultConfig) spec

spec :: Spec
spec = do
  describe "ExtraData txcounts" $ do
    it "does not parse a legacy extradata" $
      example $ do
        extraData2TxsLen "" `shouldBe` Nothing
        extraData2TxsLen "Shortextra" `shouldBe` Nothing
        extraData2TxsLen (B.replicate 32 0x0) `shouldBe` Nothing
        extraData2TxsLen (B.replicate 32 0x0 <> "istanbul_extra") `shouldBe` Nothing

    it "extracts two bytes from extradata" $
      example $ do
        extraData2TxsLen (B.replicate 32 0x6a) `shouldBe` Just 0x6a6a
        extraData2TxsLen (B.replicate 32 0x76 <> "istanbul_extra") `shouldBe` Just 0x7676
        extraData2TxsLen ("\x00\x82" <> B.replicate 30 0x0) `shouldBe` Just 0x82
        extraData2TxsLen ("\x94\x00" <> B.replicate 40 0x0) `shouldBe` Just 0x9400

    it "stores length in extradata" $
      example $ do
        txsLen2ExtraData 0 `shouldBe` B.replicate 32 0x0
        txsLen2ExtraData 0xffff `shouldBe` ("\xff\xff" <> B.replicate 30 0x0)
        txsLen2ExtraData 0xabcd `shouldBe` ("\xab\xcd" <> B.replicate 30 0x0)
        txsLen2ExtraData 0xef `shouldBe` ("\x00\xef" <> B.replicate 30 0x0)
        txsLen2ExtraData 0x1000 `shouldBe` ("\x10\x00" <> B.replicate 30 0x0)

    it "round trips data appropriately" $
      property $ \(w :: Word16) ->
        let input = fromIntegral w
            got = extraData2TxsLen $ txsLen2ExtraData input
         in if input > 0
              then got `shouldBe` Just input
              else got `shouldBe` Nothing

  describe "Data round trips" $ do
    enodeRLP
    enodeJSON
    accountRLP
    accountJSON
    codePtrRLP
    codePtrJSON
    codeRLP
    codeJSON
    actionJSON
    transactionRLP
    transactionJSON
    transactionRLPBack
    transactionJSONBack
    addressTesting
    rawtxRoundTrip
    blockDataRoundTrip
    txRoundTrip
    matchingHash
    blockRoundTrip
    codeRoundTrip
    eventualHashIdempotency
    eventualFromIdempotency
    sigRecovery

  describe "Word256" $ do
    it "shows correctly" $ do
      show (0x0 :: Word256) `shouldBe` "0"
      show (0x7 :: Word256) `shouldBe` "7"
      show (0x45 :: Word256) `shouldBe` "69"

    it "renders json correctly" $ do
      encode (0x0 :: Word256) `shouldBe` "\"0000000000000000000000000000000000000000000000000000000000000000\""
      encode (0x7 :: Word256) `shouldBe` "\"0000000000000000000000000000000000000000000000000000000000000007\""
      encode (0x45 :: Word256) `shouldBe` "\"0000000000000000000000000000000000000000000000000000000000000045\""

  describe "Address" $ do
    prop "has inverse JSON decode/encode" $ jsonProp @Address
    prop "has inverse HTTP Api Data decode/encode" $ httpApiDataProp @Address
    prop "has inverse Form Url decode/encode" $ formProp @Address
    prop "has inverse String decode/encode" $ \address ->
      stringAddress (formatAddressWithoutColor address) === Just address
    prop "has inverse String decode/encode (even if encoded prefixed with 0x)" $ \address ->
      stringAddress ("0x" <> formatAddressWithoutColor address) === Just address

  describe "Keccak256" $ do
    prop "has inverse JSON decode/encode" $ jsonProp @Keccak256
    prop "has inverse HTTP Api Data decode/encode" $
      httpApiDataProp @Keccak256
    prop "has inverse Form Url decode/encode" $ formProp @Keccak256
    prop "has inverse String decode/encode" $ \hash' ->
      stringKeccak256 (formatKeccak256WithoutColor hash') === Just hash'

-- helpers

jsonProp :: (Eq x, Show x, FromJSON x, ToJSON x) => x -> Property
jsonProp x = decode (encode x) === Just x

{-
readShowProp :: (Eq x, Read x, Show x) => x -> Property
readShowProp = liftA2 (===) (readMaybe . show) Just
-}

httpApiDataProp ::
  (Eq x, Show x, FromHttpApiData x, ToHttpApiData x) => x -> Property
httpApiDataProp x =
  parseQueryParam (toQueryParam x) === Right x
    .&&. parseUrlPiece (toUrlPiece x) === Right x
    .&&. parseHeader (toHeader x) === Right x

formProp :: (Eq x, Show x, FromForm x, ToForm x) => x -> Property
formProp x = fromForm (toForm x) === Right x

rlpRT :: (RLPSerializable a) => a -> a
rlpRT = rlpDecode . rlpDeserialize . rlpSerialize . rlpEncode

rlpCheck :: (Eq a, Show a, RLPSerializable a) => a -> Expectation
rlpCheck x = rlpRT x `shouldBe` x

jsonRT :: (ToJSON a, FromJSON a) => a -> a
jsonRT = either (error . ("Failed jsonRT: " ++)) id . Ae.eitherDecode . Ae.encode

jsonCheck :: (Eq a, Show a, ToJSON a, FromJSON a) => a -> Expectation
jsonCheck x = jsonRT x `shouldBe` x

enodeRLP :: Spec
enodeRLP = do
  it "should convert an Enode address to and from its RLP encoding" $
    property
      (\x -> rlpCheck (x :: Enode))

enodeJSON :: Spec
enodeJSON = do
  it "should convert an Enode address to and from its JSON encoding" $
    property
      (\x -> jsonCheck (x :: Enode))

accountRLP :: Spec
accountRLP = do
  it "should convert an Account to and from its RLP encoding" $
    property
      (\x -> rlpCheck (x :: Address))

accountJSON :: Spec
accountJSON = do
  it "should convert an Account to and from its JSON encoding" $
    property
      (\x -> jsonCheck (x :: Address))

codePtrRLP :: Spec
codePtrRLP = do
  it "should convert a CodePtr to and from its RLP encoding" $
    property
      (\x -> rlpCheck (x :: CodePtr))

codePtrJSON :: Spec
codePtrJSON = do
  it "should convert a CodePtr to and from its JSON encoding" $
    property
      (\x -> jsonCheck (x :: CodePtr))

codeRLP :: Spec
codeRLP = do
  it "should convert a Code to and from its RLP encoding" $
    property
      (\x -> rlpCheck (x :: Code))

codeJSON :: Spec
codeJSON = do
  it "should convert a Code to and from its JSON encoding" $
    property
      (\x -> jsonCheck (x :: Code))

actionJSON :: Spec
actionJSON = do
  it "should convert an Action to and from its JSON encoding" $
    property
      (\x -> jsonCheck (x :: Map Word256 Word256))

transactionRLP :: Spec
transactionRLP = do
  it "should convert a Transaction to and from its RLP encoding" $
    property
      (\x -> rlpCheck (x :: Transaction))

transactionJSON :: Spec
transactionJSON = do
  it "should convert a Transaction' to and from its JSON encoding" $
    property $
      jsonCheck . Transaction'

transactionRLPBack :: Spec
transactionRLPBack = do
  it "should convert a Transaction to and from its RLP encoding for backwards compatibility" $
    forAll (arbitrary `suchThat` (\_ -> True))
      (\x -> rlpCheck (x :: Transaction))

transactionJSONBack :: Spec
transactionJSONBack = do
  it "should convert a Transaction' to and from its JSON encoding for backwards compatibility" $
    forAll (arbitrary `suchThat` (\_ -> True)) $
      jsonCheck . Transaction'

addressTesting :: Spec
addressTesting = forM_ testAddresses $ \input -> do
  it ("fromJSON . toJSON = id on address " ++ input) $ do
    let o = T.unpack . addressToString . stringToAddress $ input
    o `shouldBe` input

stringToAddress :: [Char] -> Address
stringToAddress x =
  Address $
    bytesToWord160 $
      B.unpack $
        LabeledError.b16Decode "stringToAddress" $
          T.encodeUtf8 $
            T.pack x

addressToString :: Address -> T.Text
addressToString address =
  let t = case toJSON address of
        (Ae.String t') -> t'
        _ -> error "addressToString: toJSON returned non-string"
   in t

testAddresses :: [String]
testAddresses = map (\i -> replicate (40 - i) '0' ++ replicate i 'a') [0 .. 40]

sigRecovery :: Spec
sigRecovery = it "whoSignedThisTransaction works with both Haskoin and secp256k1-haskell recovery functions" $ do
  mapM_
    ( \fp -> do
        tx' <- unsafeExtractTX fp
        let tx = tPrimeToT tx'
            err = error "whoSignedThisTransaction failed"
            hkRec = fromMaybe err $ whoSignedThisTransaction tx
            ecRec = fromMaybe err $ ecWhoSignedThisTransaction tx
        hkRec `shouldBe` ecRec
    )
    ["test/testdata/transaction.json", "test/testdata/single_contract_tx.json"]

ecWhoSignedThisTransaction :: Transaction -> Maybe Address
ecWhoSignedThisTransaction tx = fromPublicKey <$> recoverPub sig mesg
    where
      intToBSS = BSS.toShort . word256ToBytes . fromInteger
      sig = Signature (SEC.CompactRecSig (intToBSS $ transactionR tx) (intToBSS $ transactionS tx) (transactionV tx - 0x1b))
      mesg = keccak256ToByteString $ partialTransactionHash tx

blockRoundTrip :: Spec
blockRoundTrip = it "preserves blocks in json -> hs -> json" $ do
  rawInput <- readFile "test/testdata/block.json" :: IO String
  let input = C8.pack rawInput
  let block = Ae.eitherDecode input :: Either String [Block']
  compareJSON input block

rawtxRoundTrip :: Spec
rawtxRoundTrip = it "preserves raw transactions in json -> hs -> json" $ do
  rawInput <- readFile "test/testdata/rawtransaction.json" :: IO String
  let input = C8.pack rawInput
  let txs = Ae.eitherDecode input :: Either String [RawTransaction']
  compareJSON input txs

blockDataRoundTrip :: Spec
blockDataRoundTrip = it "preserves blockdata in json -> hs -> json" $ do
  rawInput <- readFile "test/testdata/blockdata.json" :: IO String
  let input = C8.pack rawInput
  let block = Ae.eitherDecode input :: Either String [BlockData']
  compareJSON input block

txRoundTrip :: Spec
txRoundTrip = it "preserves transactions in json -> hs -> json" $ do
  rawInput <- readFile "test/testdata/transaction.json" :: IO String
  let input = C8.pack rawInput
  let tx = Ae.eitherDecode input :: Either String [Transaction']
  compareJSON input tx

codeRoundTrip :: Spec
codeRoundTrip = it "preserves code in json -> hs -> json" $ do
  let input = C8.pack "\"de5f72fd\""
  let code = Ae.eitherDecode input :: Either String Code
  compareJSON input code

-- compare checks that the parsed value (`actual`) is structurally equivalent
-- to the bytestring by diffing the corresponding Aeson.Values
compareJSON :: (ToJSON a) => C8.ByteString -> Either String a -> Expectation
compareJSON expected actual =
  case actual of
    Left r -> expectationFailure r
    Right c ->
      let o = Ae.encode c
          inValue = Ae.eitherDecode expected :: Either String Ae.Value
          outValue = Ae.eitherDecode o :: Either String Ae.Value
       in liftM2 diff inValue outValue `shouldBe` Right (Patch [])

unsafeExtractTX :: String -> IO Transaction'
unsafeExtractTX file = do
  rawInput <- readFile file
  let input = C8.pack rawInput
  return $ case Ae.eitherDecode input :: Either String [Transaction'] of
    Right (tx:_) -> tx
    _ -> undefined

matchingHash :: Spec
matchingHash = it "doesnt mutate the hash" $ do
  tx <- unsafeExtractTX "test/testdata/single_contract_tx.json"
  rawInput <- readFile "test/testdata/single_contract_tx.json"
  let input = C8.pack rawInput
  let decodedInput = Ae.eitherDecode input :: Either String Ae.Value
  let obj = case decodedInput of
        Right (Array os) -> V.head os
        _ -> undefined
  let h = case obj of
        Object o -> KM.lookup "hash" o
        _ -> undefined

  let jsonHash = case h of
        Just (String hs) -> hs
        _ -> undefined
  jsonHash
    `shouldBe` ( T.pack
                   . keccak256ToHex
                   . transactionHash
                   . tPrimeToT
                   $ tx
               )

rt :: Transaction' -> Maybe Transaction'
rt = Ae.decode . Ae.encode

maybeStar :: (a -> Maybe a) -> a -> [a]
maybeStar f x = x : maybe [] (maybeStar f) (f x)

eventualHashIdempotency :: Spec
eventualHashIdempotency = it "converged to a hash" $ do
  tx <- unsafeExtractTX "test/testdata/single_contract_tx.json"
  let hashes = map (transactionHash . tPrimeToT) . take 3 . maybeStar rt $ tx
  case hashes of
    [] -> hashes `shouldNotBe` hashes
    (h:_) -> hashes `shouldBe` replicate 3 h

eventualFromIdempotency :: Spec
eventualFromIdempotency = it "converged to a from" $ do
  tx <- unsafeExtractTX "test/testdata/single_contract_tx.json"
  let froms = map (whoSignedThisTransaction . tPrimeToT) . take 3 . maybeStar rt $ tx
  case froms of
    [] -> froms `shouldNotBe` froms
    (f:_) -> froms `shouldBe` replicate 3 f
