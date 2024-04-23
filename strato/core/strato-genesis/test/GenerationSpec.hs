{-# LANGUAGE OverloadedStrings #-}

module GenerationSpec where

import Blockchain.Data.ChainInfo
import Blockchain.Data.GenesisInfo
import Blockchain.Generation
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import qualified Data.Aeson as Ae
import Data.Bits
import qualified Data.ByteString as BS
import qualified Data.Text as T
import qualified Data.Vector as V
import Test.Hspec

start :: GenesisInfo
start = defaultGenesisInfo

emptySource :: T.Text
emptySource = "contract x {}"

emptySourceHash :: Keccak256
emptySourceHash = unsafeCreateKeccak256FromWord256 0xc4295782f7f9af2134f7beb6b68eedcd32a5a44f8fbcc68d87e663d1d56b3d4f

emptyContractB16 :: BS.ByteString
emptyContractB16 = "60606040525b600080fd00a165627a7a723058209b97b86115f9dfccb5f10ab93044730e948264e405825b26dccd1605775663710029"

emptyContract :: BS.ByteString
emptyContract = "```@R[`\NUL\128\253\NUL\161ebzzr0X \155\151\184a\NAK\249\223\204\181\241\n\185\&0Ds\SO\148\130d\228\ENQ\130[&\220\205\SYN\ENQwVcq\NUL)"

vehicleContractB16 :: BS.ByteString
vehicleSource :: T.Text
vehicleSource =
  "contract Vehicle {\
  \  uint timestamp;\
  \  string public vin;\
  \  string public s0;\
  \\
  \  function vin() public returns (string) {\
  \    return vin;\
  \  }\
  \\
  \  function init(string _vin, string _s0) public { \
  \    timestamp = block.timestamp; \
  \    vin = _vin;\
  \    _s0 = s0;\
  \  }\
  \}"
vehicleContractB16 = "60606040526000357c0100000000000000000000000000000000000000000000000000000000900463ffffffff168063501e8212146100545780637029144c146100e3578063aca2d46414610183575b600080fd5b341561005f57600080fd5b610067610212565b6040518080602001828103825283818151815260200191508051906020019080838360005b838110156100a85780820151818401525b60208101905061008c565b50505050905090810190601f1680156100d55780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b34156100ee57600080fd5b610181600480803590602001908201803590602001908080601f0160208091040260200160405190810160405280939291908181526020018383808284378201915050505050509190803590602001908201803590602001908080601f016020809104026020016040519081016040528093929190818152602001838380828437820191505050505050919050506102b0565b005b341561018e57600080fd5b610196610370565b6040518080602001828103825283818151815260200191508051906020019080838360005b838110156101d75780820151818401525b6020810190506101bb565b50505050905090810190601f1680156102045780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b60028054600181600116156101000203166002900480601f0160208091040260200160405190810160405280929190818152602001828054600181600116156101000203166002900480156102a85780601f1061027d576101008083540402835291602001916102a8565b820191906000526020600020905b81548152906001019060200180831161028b57829003601f168201915b505050505081565b4260008190555081600190805190602001906102cd929190610419565b5060028054600181600116156101000203166002900480601f0160208091040260200160405190810160405280929190818152602001828054600181600116156101000203166002900480156103645780601f1061033957610100808354040283529160200191610364565b820191906000526020600020905b81548152906001019060200180831161034757829003601f168201915b505050505090505b5050565b610378610499565b60018054600181600116156101000203166002900480601f01602080910402602001604051908101604052809291908181526020018280546001816001161561010002031660029004801561040e5780601f106103e35761010080835404028352916020019161040e565b820191906000526020600020905b8154815290600101906020018083116103f157829003601f168201915b505050505090505b90565b828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061045a57805160ff1916838001178555610488565b82800160010185558215610488579182015b8281111561048757825182559160200191906001019061046c565b5b50905061049591906104ad565b5090565b602060405190810160405280600081525090565b6104cf91905b808211156104cb5760008160009055506001016104b3565b5090565b905600a165627a7a72305820721353bedc910009982be0835995cfa36bf79e589916b133d022941d644d4f050029"

vehicleHash :: Keccak256
vehicleHash = unsafeCreateKeccak256FromWord256 0x7e24eb3319d8b055c7a27509a1abee64fed1b7acb070accf6a6764a11915c915

sharedStart :: Address
sharedStart = Address 0x692a70d2e424a56d2c6c27aa97d1a86395877b3a

spec :: Spec
spec = do
  describe "Insertion of empty contracts" $ do
    it "should insert no contracts" $
      let input = defaultGenesisInfo
          want = []
          got = insertContracts [] "x" emptySource emptyContractB16 sharedStart input
       in genesisInfoAccountInfo got `shouldBe` want

    it "should insert 1 contract" $
      let input = defaultGenesisInfo
          want = [ContractWithStorage sharedStart 0 (ExternallyOwned emptySourceHash) []]
          got = insertContracts [[]] "x" emptySource emptyContractB16 sharedStart input
       in genesisInfoAccountInfo got `shouldBe` want

    it "should insert 1m contracts" $
      let total = 1000000 :: Int
          slots = replicate total []
          input = defaultGenesisInfo
          want = map (\n -> ContractWithStorage (sharedStart + fromIntegral n) 0 (ExternallyOwned emptySourceHash) []) [0 .. total - 1]
          got = insertContracts slots "x" emptySource emptyContractB16 sharedStart input
       in genesisInfoAccountInfo got `shouldBe` want

    it "should add emptyContract to the contractInfo" $
      let input = defaultGenesisInfo
          want = [CodeInfo emptyContract emptySource $ Just "x"]
          slots = replicate 10 []
          got = insertContracts slots "x" emptySource emptyContractB16 sharedStart input
       in genesisInfoCodeInfo got `shouldBe` want

    it "should have the right vehicle hash" $
      let input = defaultGenesisInfo
          want = [vehicleHash]
          slots = replicate 10 []
          got =
            map hash
              . map (\(CodeInfo bin _ _) -> bin)
              . genesisInfoCodeInfo
              . insertContracts slots "Vehicle" vehicleSource vehicleContractB16 sharedStart
              $ input
       in got `shouldBe` want

  describe "Parsing storage values" $ do
    it "Should accept JSON of strings, ints, and arrays" $
      let input =
            "[[4, \"life, \\\"the universe,\\\" everything\", -90909], \
            \ [\"one string on this line\"], \
            \ [[\"one\", \"fish\"], [\"red\"], [1, 2, 3]]]"
          want =
            Right
              [ [Number 4, Stryng "life, \"the universe,\" everything", Number (-90909)],
                [Stryng "one string on this line"],
                [ List . V.fromList $ [Stryng "one", Stryng "fish"],
                  List . V.fromList $ [Stryng "red"],
                  List . V.fromList $ [Number 1, Number 2, Number 3]
                ]
              ]
          got = Ae.eitherDecode input
       in got `shouldBe` want

  describe "Encoding storage values" $ do
    it "Should encode nonegative integers" $
      let input = Records [[Number 0xfffffff, Number 0]]
          want = [[(0, 0xfffffff), (1, 0)]]
          got = encodeAllRecords input
       in got `shouldBe` want

    it "Should encode short strings" $
      let input = Records [[Stryng "\x30\x31\x42"]]
          want = [[(0, 0x303142 `shiftL` (29 * 8) .|. 3 `shiftL` 1)] :: [(Word256, Word256)]]
          got = encodeAllRecords input
       in -- Compare in JSON domain just so things are formatted in hex
          Ae.encode got `shouldBe` Ae.encode want

    it "Should encode UTF8 strings of 31 bytes" $
      let input = Records [[Stryng "¯|_(ツ)_/¯筋ランキンxyz"]]
          -- Tip: $ printf "¯|_(ツ)_/¯筋ランキンxyz" | xxd
          want =
            [ [ ( 0,
                  0xc2af7c5f28e38384295f2fc2afe7ad8be383a9e383b3e382ade383b378797a00
                    .|. 31 `shiftL` 1
                )
              ]
            ] ::
              [[(Word256, Word256)]]
          got = encodeAllRecords input
       in Ae.encode got `shouldBe` Ae.encode want

    it "Should encode long strings properly" $
      let input = Records [[Number 10, Number 13, Stryng . T.replicate 100 $ "D"]]
          -- NB: keccak256(uint256(2)) = 0x405787FA12A823E0F2B7631CC41B3BA8828B3321CA811111FA75CD3AA3BB5ACE
          want =
            [ [ (0, 10),
                (1, 13),
                (2, 201),
                ( 0x405787FA12A823E0F2B7631CC41B3BA8828B3321CA811111FA75CD3AA3BB5ACE,
                  0x4444444444444444444444444444444444444444444444444444444444444444
                ),
                ( 0x405787FA12A823E0F2B7631CC41B3BA8828B3321CA811111FA75CD3AA3BB5ACF,
                  0x4444444444444444444444444444444444444444444444444444444444444444
                ),
                ( 0x405787FA12A823E0F2B7631CC41B3BA8828B3321CA811111FA75CD3AA3BB5AD0,
                  0x4444444444444444444444444444444444444444444444444444444444444444
                ),
                ( 0x405787FA12A823E0F2B7631CC41B3BA8828B3321CA811111FA75CD3AA3BB5AD1,
                  0x4444444400000000000000000000000000000000000000000000000000000000
                )
              ]
            ] ::
              [[(Word256, Word256)]]
          got = encodeAllRecords input
       in Ae.encode got `shouldBe` Ae.encode want

    it "Should encode JSON into storage slots" $
      let input = "[[9876,\"This is text\"],\n[200,\n\"More text!\"]]"
          want =
            [ [ (0, 9876),
                (1, 0x546869732069732074657874 `shiftL` (20 * 8) .|. 12 `shiftL` 1)
              ],
              [ (0, 200),
                (1, 0x4d6f7265207465787421 `shiftL` (22 * 8) .|. 10 `shiftL` 1)
              ]
            ] ::
              [[(Word256, Word256)]]
          got = encodeJSON input
       in got `shouldBe` want

    it "Should encode integer arrays" $
      let input = "[[[1, 2, 3, 4, 5]]]"
          -- NB: keccak(uint256(0)) =  0x290...
          want =
            [ [ ( 0x0000000000000000000000000000000000000000000000000000000000000000,
                  0x0000000000000000000000000000000000000000000000000000000000000005
                ),
                ( 0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563,
                  0x0000000000000000000000000000000000000000000000000000000000000001
                ),
                ( 0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e564,
                  0x0000000000000000000000000000000000000000000000000000000000000002
                ),
                ( 0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e565,
                  0x0000000000000000000000000000000000000000000000000000000000000003
                ),
                ( 0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e566,
                  0x0000000000000000000000000000000000000000000000000000000000000004
                ),
                ( 0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e567,
                  0x0000000000000000000000000000000000000000000000000000000000000005
                )
              ]
            ]
          got = encodeJSON input
       in got `shouldBe` want

  it "Should encode arrays of arrays" $
    let input = "[[7, [[3, 127]]]]"
        -- NB: keccak(uint256(1)) = 0xb10e2d...
        -- NB: kecack(keccak(uint256(1))) = 0xb5d9d8...
        want =
          [ [ ( 0x0000000000000000000000000000000000000000000000000000000000000000,
                0x0000000000000000000000000000000000000000000000000000000000000007 -- row[0] = 7
              ),
              ( 0x0000000000000000000000000000000000000000000000000000000000000001,
                0x0000000000000000000000000000000000000000000000000000000000000001 -- len(row[1]) = 1
              ),
              ( 0xb10e2d527612073b26eecdfd717e6a320cf44b4afac2b0732d9fcbe2b7fa0cf6,
                0x0000000000000000000000000000000000000000000000000000000000000002 -- len(row[1][0]) = 2
              ),
              ( 0xb5d9d894133a730aa651ef62d26b0ffa846233c74177a591a4a896adfda97d22,
                0x0000000000000000000000000000000000000000000000000000000000000003 -- row[1][0] = 3
              ),
              ( 0xb5d9d894133a730aa651ef62d26b0ffa846233c74177a591a4a896adfda97d23,
                0x000000000000000000000000000000000000000000000000000000000000007f -- row[1][1] = 127
              )
            ]
          ]
        got = encodeJSON input
     in got `shouldBe` want

  it "Should encode structs" $
    let input = "[[{\"0\": 255, \"1\": \"unique,newyork\"}]]"
        want =
          [ [ ( 0x0000000000000000000000000000000000000000000000000000000000000000,
                0x00000000000000000000000000000000000000000000000000000000000000ff
              ),
              ( 0x0000000000000000000000000000000000000000000000000000000000000001,
                0x756e697175652c6e6577796f726b00000000000000000000000000000000001c
              )
            ]
          ]
        got = encodeJSON input
     in got `shouldBe` want
  it "Should encode integers after structs" $
    let input = "[[{\"0\": 65535, \"1\": 16777215, \"2\": 4294967295}, 93, 101]]"
        want =
          [ [ ( 0x0000000000000000000000000000000000000000000000000000000000000000,
                0x000000000000000000000000000000000000000000000000000000000000ffff
              ),
              ( 0x0000000000000000000000000000000000000000000000000000000000000001,
                0x0000000000000000000000000000000000000000000000000000000000ffffff
              ),
              ( 0x0000000000000000000000000000000000000000000000000000000000000002,
                0x00000000000000000000000000000000000000000000000000000000ffffffff
              ),
              ( 0x0000000000000000000000000000000000000000000000000000000000000003,
                0x000000000000000000000000000000000000000000000000000000000000005d
              ),
              ( 0x0000000000000000000000000000000000000000000000000000000000000004,
                0x0000000000000000000000000000000000000000000000000000000000000065
              )
            ]
          ]
        got = encodeJSON input
     in got `shouldBe` want

  it "Should encode structs of structs" $
    let input =
          "[[\
          \{\"0\": {\"a\": {\"A\": 1,    \
          \                 \"B\": 3},   \
          \         \"b\": {\"A\": 7,    \
          \                 \"B\": 15}}, \
          \ \"1\": {\"a\": {\"A\": 31,   \
          \                 \"B\": 63},  \
          \         \"b\": {\"A\": 127,  \
          \                 \"B\": 255}}}\
          \]]"
        want = [zip [0 ..] [1, 3, 7, 15, 31, 63, 127, 255]]
        got = encodeJSON input
     in got `shouldBe` want

  it "Should encode lists of structs" $
    let input =
          "[[[\
          \{\"x\": 15,      \
          \ \"y\": 255},    \
          \{\"x\": 4095,    \
          \ \"y\": 65535},  \
          \{\"x\": 1048575, \
          \ \"y\": 16777215}\
          \]]]"
        want =
          [ [ ( 0x0000000000000000000000000000000000000000000000000000000000000000,
                0x0000000000000000000000000000000000000000000000000000000000000003
              ),
              ( 0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563,
                0x000000000000000000000000000000000000000000000000000000000000000f
              ),
              ( 0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e564,
                0x00000000000000000000000000000000000000000000000000000000000000ff
              ),
              ( 0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e565,
                0x0000000000000000000000000000000000000000000000000000000000000fff
              ),
              ( 0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e566,
                0x000000000000000000000000000000000000000000000000000000000000ffff
              ),
              ( 0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e567,
                0x00000000000000000000000000000000000000000000000000000000000fffff
              ),
              ( 0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e568,
                0x0000000000000000000000000000000000000000000000000000000000ffffff
              )
            ]
          ]
        got = encodeJSON input
     in got `shouldBe` want

  it "Should encode mapping(bytes32 => uint)" $
    let input =
          "[[{\"hello, world\": 255, \
          \  \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\":65535, \
          \  \"zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz\": 16777215}]]"
        want =
          [ [ -- Mapping reserved spot
              ( 0x0000000000000000000000000000000000000000000000000000000000000000,
                0x0000000000000000000000000000000000000000000000000000000000000000
              ),
              -- keccak256('a' * 32 + '\0' * 32) = 31db...
              ( 0x31bdf21e71593a7b324dcbb99d5d011856259a09fdda85b2c97448b1bb45c2de,
                0x000000000000000000000000000000000000000000000000000000000000ffff
              ),
              -- keccak256("hello, world" + '\0' * 20 <> uint256(0)) = 0cfed6...
              ( 0x0cfed68a184422f13ee7ec91f5da2bb2308dd2f99b1e970d69a8fe4a32752620,
                0x00000000000000000000000000000000000000000000000000000000000000ff
              ),
              -- Strings longer than 32 bytes are truncated to 32
              -- keccak256('z' * 32 + '\0' * 32) = 4490...
              ( 0x4490202cf2d5b5a4a1cc5b09643c81c0a37330a9ec8d1249a2b2febd1150027b,
                0x0000000000000000000000000000000000000000000000000000000000ffffff
              )
            ]
          ]
        got = encodeJSONHashMaps input
     in got `shouldBe` want
