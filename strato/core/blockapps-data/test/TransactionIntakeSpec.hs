{-# LANGUAGE OverloadedStrings #-}

module TransactionIntakeSpec (spec) where

import Blockchain.Data.Transaction
import Blockchain.Data.TransactionIntake
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Code
import Control.Exception (ErrorCall (..), evaluate, throw)
import Control.Monad (forM_)
import qualified Data.ByteString as B
import Data.Text (Text)
import qualified Data.Text as T
import Data.Word (Word8)
import Test.Hspec

upquark, helium :: Integer
upquark = 123354377739506
helium = 195049586845898

rules :: IntakeRules
rules = IntakeRules upquark

message :: Text -> [Text] -> Text -> Maybe Integer -> Word8 -> Transaction
message name texts label cid ver = MessageTX 7 1000000 (Address 0x93fb) name texts label cid 1 1 27 ver B.empty

transferArgs :: [Text]
transferArgs = ["\"5b8f21b53d3a5ea7dd66710ff18d161bb62e9a71\"", "100"]

-- | A well-formed server-signed call; each case changes one thing.
call :: Transaction
call = message "transfer" transferArgs "mercata" (Just upquark) 0

named :: Text -> Transaction
named name = message name transferArgs "mercata" (Just upquark) 0

withArgs :: [Text] -> Transaction
withArgs texts = message "transfer" texts "mercata" (Just upquark) 0

onNetwork :: Text -> Transaction
onNetwork label = message "transfer" transferArgs label (Just upquark) 0

creationOf :: Text -> [Text] -> Transaction
creationOf name texts = ContractCreationTX 0 1000000 name texts "mercata" (Code "contract Example {}") (Just upquark) 1 1 27 0

creation :: Transaction
creation = creationOf "Example" []

legacyEthereum, typedEthereum :: Transaction
legacyEthereum = EthereumTX 3 0 21000 (Just (Address 0xa0de)) 8980000000000000000 B.empty (Just upquark) 1 1 0 0 0
typedEthereum = legacyEthereum {txVersion = 2}

accepts :: Transaction -> Expectation
accepts tx = validateIntake rules tx `shouldBe` Right ()

rejects :: Transaction -> IntakeRejection -> Expectation
rejects tx reason = validateIntake rules tx `shouldBe` Left reason

shown :: Text -> String
shown = show . T.unpack

spec :: Spec
spec = describe "Blockchain.Data.TransactionIntake" $ do
  describe "function names SolidVM can dispatch" $ do
    forM_
      [ "transfer", "setAssetPrices", "createUser", "_private", "$dollar", "a1", "x", "castVoteOnIssue",
        "fallback", "receive", "\252berweisen",
        "ping()", "transfer(address,uint256)", "transfer(address, uint256)", "pay(address payable)",
        "set(Lib.Thing,string)", "f(uint,int8,bytes32,bool,decimal,variadic)"
      ]
      $ \name -> it ("admits " ++ shown name) $ accepts (named name)

  describe "malformed function names" $ do
    forM_
      [ "", " ", "   ", "\t", " transfer", "transfer ", "transfer\n", "\ntransfer", "trans fer",
        "1abc", "a-b", "a.b", "a;b", "transfer;", "transfer--", "function", "contract", "uint",
        "transfer(address)extra", "transfer(address) ", " transfer(address)", "transfer (address)",
        "transfer/*x*/(address)", "transfer(address)//x", "transfer(address,,uint)", "transfer(address",
        "transfer)", "(uint)", "fallback(uint)", "transfer(address)(uint)", "transfer(address,  uint)",
        "transfer(uint[])", "transfer(mapping(address => uint))", "transfer(\"x\")", "transfer(1)",
        "transfer<uint>", "transfer amount=1", "set key='a'"
      ]
      $ \name -> it ("rejects " ++ shown name) $ rejects (named name) MalformedFunctionName

  describe "external constructor calls" $ do
    forM_
      [ "<constructor>", " <constructor>", "<constructor> ", "  <constructor>  ", "\t<constructor>\n",
        "<constructor>()", "<constructor>(uint256)", "<constructor> (uint256)", "  <constructor>  (  )",
        "<constructor>(", "<constructor>(address,address) trailing", "\160<constructor>"
      ]
      $ \name -> it ("rejects " ++ shown name) $ rejects (named name) ConstructorCall

    it "rejects a constructor name passed to a wrapped call, at any depth" $ do
      rejects (withArgs ["\"<constructor>\""]) (NestedConstructorCall 0)
      rejects (withArgs ["1", "\" <constructor> (uint)\""]) (NestedConstructorCall 1)
      rejects (withArgs ["[\"transfer\", [\"<constructor>\"]]"]) (NestedConstructorCall 0)
      rejects (withArgs ["{to:\"93fb\",fn:\"<constructor>()\"}"]) (NestedConstructorCall 0)
      rejects (withArgs ["string(\"<constructor>\")"]) (NestedConstructorCall 0)
      rejects (withArgs ["[string(\" <constructor> \")]"]) (NestedConstructorCall 0)

    it "admits prose that only mentions the label" $ do
      accepts (withArgs ["\"The <constructor> label is internal to SolidVM.\""])
      accepts (withArgs ["\"constructor\""])
      accepts (withArgs ["\"<constructors>\""])

  describe "arguments" $ do
    it "admits every kind of SolidVM literal" $
      forM_
        [ ["123"], ["-5"], ["+5"], ["1.5"], ["true"], ["false"], ["\"\""], ["\"text\""], ["hex\"00ff\""],
          ["\"5b8f21b53d3a5ea7dd66710ff18d161bb62e9a71\""], ["[]"], ["[1,2,3]"], ["[\"a\",\"b\"]"],
          ["[[1],[2,3]]"], ["address(0)"], ["uint(7)"],
          ["{actionHash:0,amountIn:1000000000000000000,recipient:\"d94a3d8069ff9efb13f6a951c431661a19f769ce\"}"],
          []
        ]
        $ \texts -> accepts (withArgs texts)

    it "admits any text inside a string literal" $
      forM_
        [ "\"Gold - 1 Gram Coin\"",
          "\"<p style=\\\"text-align:center\\\">Gold - 1 Gram Coin</p>\"",
          "\"it's 5 > 3 & 2 < 4; done -- really\"",
          "\"transfer(address,uint256)\"",
          "[\"<b>bold</b>\", \"<a href=\\\"https://example.org\\\">link</a>\"]"
        ]
        $ \text -> accepts (withArgs [text])

    it "admits a large source-code argument" $
      accepts (withArgs ["\"" <> T.replicate 20000 "contract A { uint x; function f() public { x = x + 1; } } " <> "\""])

    forM_
      [ "", " ", "abc", "1 2", "\"unterminated", "\"a\" \"b\"", "1;", "transfer(1)", "x = 1", "1 + 1",
        "[1,2", "{a:1", "\"a\"b", "<b>bold</b>", "Gold - 1 Gram Coin"
      ]
      $ \text -> it ("rejects the non-literal " ++ shown text) $ rejects (withArgs [text]) (MalformedArgument 0)

    it "reports the position of the first malformed argument" $
      rejects (withArgs ["1", "\"ok\"", "not a literal", "nor this"]) (MalformedArgument 2)

  describe "network and chain" $ do
    it "admits the labels signers use, with or without this chain's id, in both native versions" $
      forM_ [(label, cid, ver) | label <- ["mercata", "STRATO", "network"], cid <- [Nothing, Just upquark], ver <- [0, 1]] $
        \(label, cid, ver) -> accepts (message "transfer" transferArgs label cid ver)

    it "admits any plain label, since the node gives the field no meaning" $
      forM_ ["", "upquark", "helium", "MERCATA", "mercata-hydrogen", "net_1.2", T.replicate 64 "a"] $ \label ->
        accepts (onNetwork label)

    forM_
      [ " ", " mercata", "mercata ", "mercata\n", "mer cata", "mercata/1", "mercata;", "\252ber", T.replicate 65 "a",
        "\"mercata\"", "mercata<1>"
      ]
      $ \label -> it ("rejects the network field " ++ shown label) $ rejects (onNetwork label) MalformedNetwork

    it "rejects a transaction signed for another chain" $ do
      rejects call {chainId = Just helium} WrongChainId
      rejects call {chainId = Just 1} WrongChainId
      rejects call {chainId = Just 0} WrongChainId
      rejects creation {chainId = Just helium} WrongChainId
      rejects legacyEthereum {chainId = Just helium} WrongChainId
      rejects typedEthereum {chainId = Just helium} WrongChainId

    it "judges the chain against the node's own id, whatever it is" $ do
      validateIntake (IntakeRules helium) call {chainId = Just helium} `shouldBe` Right ()
      validateIntake (IntakeRules helium) call `shouldBe` Left WrongChainId

  describe "transaction versions" $ do
    it "admits the versions each kind defines" $ do
      forM_ [0, 1] $ \ver -> accepts call {txVersion = ver}
      forM_ [0, 1] $ \ver -> accepts creation {txVersion = ver}
      accepts legacyEthereum
      accepts legacyEthereum {chainId = Nothing}
      accepts typedEthereum

    it "rejects versions no signer defines" $ do
      forM_ [2, 3, 127, 255] $ \ver -> rejects call {txVersion = ver} (UnsupportedVersion ver)
      forM_ [2, 255] $ \ver -> rejects creation {txVersion = ver} (UnsupportedVersion ver)
      forM_ [1, 3, 255] $ \ver -> rejects legacyEthereum {txVersion = ver} (UnsupportedVersion ver)

    it "requires a typed Ethereum transaction to name the chain" $
      rejects typedEthereum {chainId = Nothing} MissingChainId

  describe "contract creation" $ do
    it "admits an identifier as the contract name" $
      forM_ ["Example", "Proxy", "_A", "Token2"] $ \name -> accepts (creationOf name [])
    forM_ ["", " ", "Example ", "My Contract", "A<B>", "A;B", "1A", "contract"] $ \name ->
      it ("rejects the contract name " ++ shown name) $ rejects (creationOf name []) MalformedContractName
    it "checks constructor arguments like call arguments" $ do
      accepts (creationOf "Example" ["\"<b>free text</b>\"", "5"])
      rejects (creationOf "Example" ["free text"]) (MalformedArgument 0)

  describe "checkIntake" $ do
    it "agrees with the pure check" $ do
      checkIntake rules call `shouldReturn` Right ()
      checkIntake rules (named "<constructor>") `shouldReturn` Left ConstructorCall
      checkIntake rules (withArgs ["not a literal"]) `shouldReturn` Left (MalformedArgument 0)

    it "lets a transaction that cannot be decoded fail as it always has" $
      checkIntake rules (withArgs [throw (ErrorCall "rlp object has wrong format")]) `shouldThrow` errorCall "rlp object has wrong format"

    it "partitions a batch without changing or reordering what it admits" $ do
      let batch = [call, named "<constructor>", named "mint", withArgs ["not a literal"], onNetwork "bad label", creation]
      (admitted, rejected) <- partitionIntake rules id batch
      admitted `shouldBe` [call, named "mint", creation]
      map snd rejected `shouldBe` [ConstructorCall, MalformedArgument 0, MalformedNetwork]

  describe "what a rejection says" $
    it "never includes text from the transaction" $ do
      let marker = "<<marker>>" :: Text
          reasons =
            [ validateIntake rules (named marker),
              validateIntake rules (withArgs [marker]),
              validateIntake rules (onNetwork marker),
              validateIntake rules (creationOf marker [])
            ]
      forM_ reasons $ \verdict -> case verdict of
        Left reason -> do
          _ <- evaluate (T.length (describeIntakeRejection reason))
          describeIntakeRejection reason `shouldSatisfy` (not . T.isInfixOf "<")
          intakeRejectionLabel reason `shouldSatisfy` T.all (\c -> c == '_' || (c >= 'a' && c <= 'z'))
        Right () -> expectationFailure "expected a rejection"
