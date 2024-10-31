{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}
{-# OPTIONS_GHC -fno-warn-overlapping-patterns #-}

import Blockchain.Data.ArbitraryInstances ()
import Blockchain.Data.BlockHeader
import Blockchain.Data.ChainInfo
import Blockchain.Data.Enode
import Blockchain.Data.Json
import Blockchain.Data.RLP
import Blockchain.Data.Transaction
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.Secp256k1
import Control.Monad
import qualified Crypto.Secp256k1 as SEC
import Data.Aeson
import Data.Aeson as Ae
import Data.Aeson.Diff
import qualified Data.Aeson.KeyMap as KM
import qualified Data.Binary as Binary
import qualified Data.ByteString as B
import qualified Data.ByteString.Lazy.Char8 as C8
import qualified Data.ByteString.Short as BSS
import Data.Map.Strict (Map)
import Data.Maybe (fromMaybe, isNothing)
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
main = hspecWith (configAddFilter predicate defaultConfig) $ do
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
    chainMembersRLP
    chainMembersJSON
    chainMembersBinary
    accountRLP
    accountJSON
    codePtrRLP
    codePtrJSON
    codeRLP
    codeJSON
    accountInfoRLP
    accountInfoJSON
    actionJSON
    codeInfoRLP
    codeInfoJSON
    chainInfoRLP
    chainInfoJSON
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
    directComparison
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

binaryRT :: Binary.Binary a => a -> a
binaryRT = Binary.decode . Binary.encode

binaryCheck :: (Eq a, Show a, Binary.Binary a) => a -> Expectation
binaryCheck x = binaryRT x `shouldBe` x

enodeRLP :: Spec
enodeRLP = do
  it "should convert an Enode address to and from its RLP encoding" $
    property $
      (\x -> rlpCheck (x :: Enode))

enodeJSON :: Spec
enodeJSON = do
  it "should convert an Enode address to and from its JSON encoding" $
    property $
      (\x -> jsonCheck (x :: Enode))

chainMembersRLP :: Spec
chainMembersRLP = do
  it "should convert an ChainMembers address to and from its RLP encoding" $
    property $
      (\x -> rlpCheck (x :: ChainMembers))

chainMembersJSON :: Spec
chainMembersJSON = do
  it "should convert an ChainMembers address to and from its JSON encoding" $
    property $
      (\x -> jsonCheck (x :: ChainMembers))

chainMembersBinary :: Spec
chainMembersBinary = do
  it "should convert an ChainMembers address to and from its Binary encoding" $
    property $
      (\x -> binaryCheck (x :: ChainMembers))

accountRLP :: Spec
accountRLP = do
  it "should convert an Account to and from its RLP encoding" $
    property $
      (\x -> rlpCheck (x :: Account))

accountJSON :: Spec
accountJSON = do
  it "should convert an Account to and from its JSON encoding" $
    property $
      (\x -> jsonCheck (x :: Account))

codePtrRLP :: Spec
codePtrRLP = do
  it "should convert a CodePtr to and from its RLP encoding" $
    property $
      (\x -> rlpCheck (x :: CodePtr))

codePtrJSON :: Spec
codePtrJSON = do
  it "should convert a CodePtr to and from its JSON encoding" $
    property $
      (\x -> jsonCheck (x :: CodePtr))

codeRLP :: Spec
codeRLP = do
  it "should convert a Code to and from its RLP encoding" $
    property $
      (\x -> rlpCheck (x :: Code))

codeJSON :: Spec
codeJSON = do
  it "should convert a Code to and from its JSON encoding" $
    property $
      (\x -> jsonCheck (x :: Code))

accountInfoRLP :: Spec
accountInfoRLP = do
  it "should convert an AccountInfo to and from its RLP encoding" $
    property $
      (\x -> rlpCheck (x :: AccountInfo))

accountInfoJSON :: Spec
accountInfoJSON = do
  it "should convert a AccountInfo to and from its JSON encoding" $
    property $
      (\x -> jsonCheck (x :: AccountInfo))

actionJSON :: Spec
actionJSON = do
  it "should convert an Action to and from its JSON encoding" $
    property $
      (\x -> jsonCheck (x :: Map Word256 Word256))

codeInfoRLP :: Spec
codeInfoRLP = do
  it "should convert an CodeInfo to and from its RLP encoding" $
    property $
      (\x -> rlpCheck (x :: CodeInfo))

codeInfoJSON :: Spec
codeInfoJSON = do
  it "should convert a CodeInfo to and from its JSON encoding" $
    property $
      (\x -> jsonCheck (x :: CodeInfo))

chainInfoRLP :: Spec
chainInfoRLP = do
  it "should convert a ChainInfo to and from its RLP encoding" $
    property $
      (\x -> rlpCheck (x :: ChainInfo))

chainInfoJSON :: Spec
chainInfoJSON = do
  it "should convert a ChainInfo to and from its JSON encoding" $
    property $
      (\x -> jsonCheck (x :: ChainInfo))

transactionRLP :: Spec
transactionRLP = do
  it "should convert a Transaction to and from its RLP encoding" $
    property $
      (\x -> rlpCheck (x :: Transaction))

transactionJSON :: Spec
transactionJSON = do
  it "should convert a Transaction' to and from its JSON encoding" $
    property $
      jsonCheck . Transaction'

transactionRLPBack :: Spec
transactionRLPBack = do
  it "should convert a Transaction to and from its RLP encoding for backwards compatibility" $
    forAll (arbitrary `suchThat` (isNothing . txMetadata)) $
      (\x -> rlpCheck (x :: Transaction))

transactionJSONBack :: Spec
transactionJSONBack = do
  it "should convert a Transaction' to and from its JSON encoding for backwards compatibility" $
    forAll (arbitrary `suchThat` (isNothing . txMetadata)) $
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
testAddresses = map (\i -> (take (40 - i) $ repeat '0') ++ (take i $ repeat 'a')) [0 .. 40]

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
ecWhoSignedThisTransaction tx = case tx of
  PrivateHashTX {} -> Just (Address 0)
  t -> fromPublicKey <$> recoverPub sig mesg
    where
      intToBSS = BSS.toShort . word256ToBytes . fromInteger
      sig = Signature (SEC.CompactRecSig (intToBSS $ transactionR t) (intToBSS $ transactionS t) ((transactionV t) - 0x1b))
      mesg = keccak256ToByteString $ partialTransactionHash t

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
       in liftM2 diff inValue outValue `shouldBe` (Right $ Patch [])

unsafeExtractTX :: String -> IO Transaction'
unsafeExtractTX file = do
  rawInput <- readFile file
  let input = C8.pack rawInput
  return $ case Ae.eitherDecode input :: Either String [Transaction'] of
    Right txs -> head txs
    Left _ -> undefined

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
  hashes `shouldBe` replicate 3 (head hashes)

eventualFromIdempotency :: Spec
eventualFromIdempotency = it "converged to a from" $ do
  tx <- unsafeExtractTX "test/testdata/single_contract_tx.json"
  let froms = map (whoSignedThisTransaction . tPrimeToT) . take 3 . maybeStar rt $ tx
  froms `shouldBe` replicate 3 (head froms)

directComparison :: Spec
directComparison = it "parses transactions correctly" $ do
  Transaction' written <- unsafeExtractTX "test/testdata/single_contract_tx.json"
  let unwritten = ContractCreationTX {transactionNonce = 0, transactionGasPrice = 1, transactionGasLimit = 100000000, transactionValue = 0, transactionInit = Code {codeBytes = "```@R4a\NUL\NULW`@Qa\EOT\140\&8\ETX\128a\EOT\140\131\&9\129\SOH`@R\128\128Q\130\SOH\145\144PP[3`\NUL`\NULa\SOH\NUL\n\129T\129s\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\STX\EM\SYN\144\131s\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\SYN\STX\ETB\144UP\128`\SOH\144\128Q\144` \SOH\144\130\128T`\SOH\129`\SOH\SYN\NAKa\SOH\NUL\STX\ETX\SYN`\STX\144\EOT\144`\NULR` `\NUL \144`\US\SOH` \144\EOT\129\SOH\146\130`\US\DLEa\NUL\179W\128Q`\255\EM\SYN\131\128\SOH\ETB\133Ua\NUL\225V[\130\128\SOH`\SOH\SOH\133U\130\NAKa\NUL\225W\145\130\SOH[\130\129\DC1\NAKa\NUL\224W\130Q\130U\145` \SOH\145\144`\SOH\SOH\144a\NUL\197V[[P\144Pa\SOH\ACK\145\144[\128\130\DC1\NAKa\SOH\STXW`\NUL\129`\NUL\144UP`\SOH\SOHa\NUL\234V[P\144V[PP[P[a\ETXr\128a\SOH\SUB`\NUL9`\NUL\243\NUL```@R`\NUL5|\SOH\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\144\EOTc\255\255\255\255\SYN\128cA\192\225\181\DC4a\NUL_W\128cB\203\177\\\DC4a\NULnW\128c\164\DC3hb\DC4a\NUL\145W\128c\207\174\&2\ETB\DC4a\NUL\232W[a\NUL\NULV[4a\NUL\NULWa\NULla\SOH~V[\NUL[4a\NUL\NULWa\NUL{a\STX\DC2V[`@Q\128\130\129R` \SOH\145PP`@Q\128\145\ETX\144\243[4a\NUL\NULWa\NUL\230`\EOT\128\128\&5\144` \SOH\144\130\SOH\128\&5\144` \SOH\144\128\128`\US\SOH` \128\145\EOT\STX` \SOH`@Q\144\129\SOH`@R\128\147\146\145\144\129\129R` \SOH\131\131\128\130\132\&7\130\SOH\145PPPPPP\145\144PPa\STX\ESCV[\NUL[4a\NUL\NULWa\NUL\245a\STX\192V[`@Q\128\128` \SOH\130\129\ETX\130R\131\129\129Q\129R` \SOH\145P\128Q\144` \SOH\144\128\131\131`\NUL\131\DC4a\SOHDW[\128Q\130R` \131\DC1\NAKa\SOHDW` \130\SOH\145P` \129\SOH\144P` \131\ETX\146Pa\SOH V[PPP\144P\144\129\SOH\144`\US\SYN\128\NAKa\SOHpW\128\130\ETX\128Q`\SOH\131` \ETXa\SOH\NUL\n\ETX\EM\SYN\129R` \SOH\145P[P\146PPP`@Q\128\145\ETX\144\243[`\NUL`\NUL\144T\144a\SOH\NUL\n\144\EOTs\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\SYNs\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\SYN3s\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\SYN\DC4\NAKa\STX\SIW`\NUL`\NUL\144T\144a\SOH\NUL\n\144\EOTs\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\SYNs\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\255\SYN\255[[V[`\NULC\144P[\144V[\128`\SOH\144\128Q\144` \SOH\144\130\128T`\SOH\129`\SOH\SYN\NAKa\SOH\NUL\STX\ETX\SYN`\STX\144\EOT\144`\NULR` `\NUL \144`\US\SOH` \144\EOT\129\SOH\146\130`\US\DLEa\STXgW\128Q`\255\EM\SYN\131\128\SOH\ETB\133Ua\STX\149V[\130\128\SOH`\SOH\SOH\133U\130\NAKa\STX\149W\145\130\SOH[\130\129\DC1\NAKa\STX\148W\130Q\130U\145` \SOH\145\144`\SOH\SOH\144a\STXyV[[P\144Pa\STX\186\145\144[\128\130\DC1\NAKa\STX\182W`\NUL\129`\NUL\144UP`\SOH\SOHa\STX\158V[P\144V[PP[PV[` `@Q\144\129\SOH`@R\128`\NUL\129RP`\SOH\128T`\SOH\129`\SOH\SYN\NAKa\SOH\NUL\STX\ETX\SYN`\STX\144\EOT\128`\US\SOH` \128\145\EOT\STX` \SOH`@Q\144\129\SOH`@R\128\146\145\144\129\129R` \SOH\130\128T`\SOH\129`\SOH\SYN\NAKa\SOH\NUL\STX\ETX\SYN`\STX\144\EOT\128\NAKa\ETXgW\128`\US\DLEa\ETX<Wa\SOH\NUL\128\131T\EOT\STX\131R\145` \SOH\145a\ETXgV[\130\SOH\145\144`\NULR` `\NUL \144[\129T\129R\144`\SOH\SOH\144` \SOH\128\131\DC1a\ETXJW\130\144\ETX`\US\SYN\130\SOH\145[PPPPP\144P[\144V\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL \NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\a\"hello\"\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL\NUL"}, transactionChainId = Nothing, transactionR = 36022858481278288224827552467961890771958827185857838718877100932401588820123, transactionS = 55223453758550732625403887355517766122602311804192371544366059495719421605700, transactionV = 27, transactionMetadata = Nothing}
  written `shouldBe` unwritten
  transactionHash written `shouldBe` transactionHash unwritten
