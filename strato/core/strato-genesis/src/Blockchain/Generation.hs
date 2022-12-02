{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE QuasiQuotes #-}


module Blockchain.Generation (
  encodeAllRecords,
  encodeJSON,
  encodeJSONHashMaps,
  insertContractsCount,
  insertContractsJSON,
  insertContractsJSONHashMaps,
  insertContracts,
  insertCertRegistryContract,
  Records(..),
  RecordsHashMap(..),
  Type(..),
  TypeHashMap(..)
) where

import qualified Data.Aeson as Ae
import qualified Data.JsonStream.Parser as JS
import Data.Bits
import Data.Maybe
import qualified Data.ByteString.Lazy as L
import qualified Data.ByteString as BS
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.List as List
import qualified Data.HashMap.Strict as HM
import Data.Scientific (floatingOrInteger)
import           Data.Text (Text)
import qualified Data.Vector as V
import Data.Text.Encoding
import GHC.Generics
import Text.RawString.QQ

import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.CodePtr
import qualified Blockchain.Strato.Model.Keccak256              as KECCAK256
import           Blockchain.Strato.Model.ExtendedWord
import           Blockchain.Strato.Model.Account
import           Blockchain.Data.GenesisInfo
import           Blockchain.Data.RLP
import           Blockchain.Data.ChainInfo

import           SolidVM.Model.Storable         hiding (size)

data Type = Number Integer
          | Stryng Text
          | List (V.Vector Type)
          | Struct [Type]
          -- TODO(tim): Make the key type generic over hashable things.
          | Mapping (HM.HashMap Text Type)
  deriving (Eq, Show, Generic)

instance Ae.FromJSON Type where
  parseJSON (Ae.String s) = return . Stryng $ s
  parseJSON (Ae.Number x) = case floatingOrInteger x :: Either Double Integer of
                                Left f -> fail $ "must be int or string: " ++ show f
                                Right n -> return . Number $ n
  parseJSON (Ae.Array as) = List <$> V.mapM Ae.parseJSON as
  parseJSON (Ae.Object ss) = let a `cmp` b = fst a `compare` fst b
                             in Struct <$> (mapM (Ae.parseJSON . snd) . List.sortBy cmp . HM.toList $ ss)
  parseJSON (Ae.Bool b) = return . Number $ if b then 1 else 0
  parseJSON _ = fail "unknown aeson type"

-- This is a clumsy hack to just create a mapping(bytes32 => uint),
-- and probably needs to be replaced with something more generic.
-- For example, this prohibits mapping(address => mapping(address => bool)),
-- both because it only uses a string key and because the values is not Type2
data TypeHashMap = Type Type | MappingHashMap (HM.HashMap Text Type) deriving (Eq, Show, Generic)

toType :: TypeHashMap -> Type
toType (Type t) = t
toType (MappingHashMap hm) = Mapping hm

instance Ae.FromJSON TypeHashMap where
  parseJSON (Ae.Object ss) = MappingHashMap <$> traverse Ae.parseJSON ss
  parseJSON v = Type <$> Ae.parseJSON v


newtype Records = Records [[Type]] deriving (Eq, Show, Generic)
instance Ae.FromJSON Records

newtype RecordsHashMap = RecordsHashMap [[TypeHashMap]] deriving (Eq, Show, Generic)
instance Ae.FromJSON RecordsHashMap

equalChunksOf :: Int -> BS.ByteString -> [BS.ByteString]
equalChunksOf n ws | BS.length ws == 0 = []
                   | BS.length ws <= n = [ws <> BS.replicate (n - BS.length ws) 0]
                   | otherwise = let (car, cdr) = BS.splitAt n ws
                                 in car : (equalChunksOf n cdr)

hash :: Word256 -> Word256
hash = bytesToWord256 . KECCAK256.keccak256ToByteString . KECCAK256.hash . word256ToBytes

encodeSequentially :: Word256 -> [Type] -> ([(Word256, Word256)], Word256)
encodeSequentially k [] = ([], k)
encodeSequentially k (t:ts) =
  let (tSlots, k') = encodeType k t
      (tsSlots, k'') = encodeSequentially k' ts
  in (tSlots ++ tsSlots, k'')

mapHash :: Word256 -> Word256 -> Word256
mapHash x y = bytesToWord256 . KECCAK256.keccak256ToByteString $ KECCAK256.hash $ word256ToBytes x <> word256ToBytes y

-- First return value is the slots for this value, and the second return value
-- is the next available slot.
encodeType :: Word256 -> Type -> ([(Word256, Word256)], Word256)
encodeType k (Number n) | n >= 0 && n <= (2 ^ (256 :: Integer)) = ([(k, fromIntegral n)], k + 1)
                        | otherwise = error "unimplemented for negative numbers"
encodeType k (Stryng s) =
  if BS.length payload < 32
      then let pad = BS.replicate (31 - BS.length payload) 0
               size = BS.singleton . fromIntegral $ BS.length payload `shiftL` 1
           in ([(k, bytesToWord256 $ payload <> pad <> size)], k+1)
      else let size = fromIntegral $ (BS.length payload `shiftL` 1) .|. 1
               pointer = (k, size)
               start = hash k
               packets = zip (map (start+) [0..]) . map bytesToWord256 . equalChunksOf 32 $ payload
           in (pointer:packets, k + 1)
  where payload = encodeUtf8 s
encodeType k (List payload) =
  let size = fromIntegral . length $ payload
      pointer = (k, size)
      start = hash k
      (packets, _) = encodeSequentially start (V.toList payload)
  in (pointer:packets, k + 1)
encodeType k (Struct ts) = encodeSequentially k ts
encodeType p (Mapping hm) =
  let pointer = (p, 0)
      -- This is very specific to the case of using bytes32 as keys.
      -- Using strings as key hashes the whole string, rather than
      -- slicing to 32 bytes and extending by 0s.
      payload s = let raw = encodeUtf8 s
                  in if BS.length raw < 33
                        then raw <> BS.replicate (32 - BS.length raw) 0
                        else BS.take 32 raw
      -- For a mapping value located in contract slot p with key s
      -- the slot is keccak256(s <> p)
      trieKey s = mapHash (bytesToWord256 . payload $ s) p
      place (s, v) = fst . encodeType (trieKey s) $ v
  in (pointer:(concatMap place . HM.toList $ hm), p+1)

encodeRecord :: Word256 -> [Type] -> [(Word256, Word256)]
encodeRecord k = fst . encodeSequentially k

encodeAllRecords :: Records -> [[(Word256, Word256)]]
encodeAllRecords (Records recs) = map (encodeRecord 0) recs


encodeJSON :: L.ByteString -> [[(Word256, Word256)]]
encodeJSON = encodeAllRecords . Records . JS.parseLazyByteString (JS.arrayOf JS.value)

insertContractsCount :: Int -> Text -> Text -> BS.ByteString -> Address -> GenesisInfo -> GenesisInfo
insertContractsCount n name src code start gi = insertContracts (replicate n []) name src code start gi

insertContractsJSON :: L.ByteString -> Text -> Text -> BS.ByteString -> Address -> GenesisInfo -> GenesisInfo
insertContractsJSON rawJSON name src code start gi = insertContracts (encodeJSON rawJSON) name src code start gi

encodeAllRecordsHashMaps :: RecordsHashMap -> [[(Word256, Word256)]]
encodeAllRecordsHashMaps (RecordsHashMap recs) = encodeAllRecords . Records . map (map toType) $ recs

encodeJSONHashMaps :: L.ByteString -> [[(Word256, Word256)]]
encodeJSONHashMaps = encodeAllRecordsHashMaps . RecordsHashMap . JS.parseLazyByteString (JS.arrayOf JS.value)

insertContractsJSONHashMaps :: L.ByteString -> Text -> Text -> BS.ByteString -> Address -> GenesisInfo -> GenesisInfo
insertContractsJSONHashMaps rawJSON name src code start gi = insertContracts (encodeJSONHashMaps rawJSON) name src code start gi

insertContracts :: [[(Word256, Word256)]] -> Text -> Text -> BS.ByteString -> Address -> GenesisInfo -> GenesisInfo
insertContracts slotss name src code start gi =
  let initialAccounts = genesisInfoAccountInfo gi
      initialCode = genesisInfoCodeInfo gi
      codeWithoutNewline = if BC.last code == '\n' then BC.init code else code
      decoded =
        case B16.decode codeWithoutNewline of
          Right v -> v
          _ -> error ("bytecode not encoded in base16:" ++ show code)
      codeHash = KECCAK256.hash decoded
      mkContract (addr, slots) = ContractWithStorage addr 0 (EVMCode codeHash) slots
      addrs = map (start+) [0..]
      addrsAndSlots = zip addrs slotss
  in gi {genesisInfoAccountInfo = initialAccounts ++ map mkContract addrsAndSlots,
         genesisInfoCodeInfo = initialCode ++ [CodeInfo decoded src $ Just name]}

insertCertRegistryContract :: GenesisInfo -> GenesisInfo
insertCertRegistryContract gi =
  let initialAccounts = genesisInfoAccountInfo gi
      initialCode     = genesisInfoCodeInfo gi
      encoded         = encodeUtf8 certificateRegistryContract
      rlpWrap         = rlpSerialize . rlpEncode 
      elfdod'         = (fromJust . stringAddress) "e1fd0d4a52b75a694de8b55528ad48e2e2cf7859"
      elfdod          = BAccount (NamedAccount elfdod' UnspecifiedChain)
      certAccount     = SolidVMContractWithStorage 0x509 509 
        (SolidVMCode "CertificateRegistry" (KECCAK256.hash encoded)) 
        [
            (".owner", rlpWrap elfdod),
            (".initialized", rlpWrap (BBool True))
        ]
  in gi {genesisInfoAccountInfo = initialAccounts ++ [certAccount],
         genesisInfoCodeInfo    = initialCode ++ [CodeInfo encoded certificateRegistryContract (Just "CertificateRegistry")]}

certificateRegistryContract :: Text
certificateRegistryContract = [r|
pragma solidvm 3.4;
contract Certificate {
    address owner;  // The CertificateRegistry Contract

    address public userAddress;
    address public parent;
    address[] public children;

    
    // Store all the fields of a certificate in a Cirrus record
    string commonName;
    string country;
    string organization;
    string group;
    string organizationalUnit;
    string public publicKey;
    string public certificateString;
    bool public isValid;
    uint expirationDate;

    constructor(string _certificateString) {
        owner = msg.sender;

        mapping(string => string) parsedCert = parseCert(_certificateString);

        userAddress = address(parsedCert["userAddress"]);
        commonName = parsedCert["commonName"];
        organization = parsedCert["organization"];
        group = parsedCert["group"];
        organizationalUnit = parsedCert["organizationalUnit"];
        country = parsedCert["country"];
        publicKey = parsedCert["publicKey"];
        certificateString = parsedCert["certString"];
        isValid = true;
        expirationDate = uint(parsedCert["expirationDate"],10);
        parent = address(parsedCert["parent"]);
        children = [];
    }
    
    function addChild(address _child) public {
        require((msg.sender == owner || msg.sender == parent),"You don't have permission to CALL addChild!");

        children.push(_child);
    }
    
    function revoke() public returns (int){
        require(msg.sender == owner,"You don't have permission to CALL revoke!");

        isValid = false;
        return children.length;
    }
    
    function getChild(int index) public returns (address){
        require(msg.sender == owner,"You don't have permission to get children!");
        
        return children[index];
    }
}

pragma solidvm 3.4;
contract CertificateRegistry {
    // The registry maintains a list and mapping of all the certificates
    // We need the extra array in order for us to iterate through our certificates.
    // Solidity mappings are non-iterable.
    Certificate[] certificates;
    mapping(address => uint) certificatesMap;
    address public owner;

    bool initialized;

    event CertificateRegistered(string certificate);
    event CertificateRevoked(address userAddress);
    event CertificateRegistryInitialized();

    constructor() {
        require(account(this, "self").chainId == 0, "You must post this contract on the main chain!");
        owner = msg.sender;

        initialized = false;
    }

    function initializeCertificateRegistry(string[] _rootCerts) returns (int) {
        require(!initialized, "The CertificateRegistry has already been initialized!");        
        
        for (uint i=0; i < _rootCerts.length; i += 1) {
            // Create the Certificate record
            Certificate c = new Certificate(_rootCerts[i]);
            // Register the root certificates and emit event
            certificates.push(c);
            certificatesMap[c.userAddress()] = certificates.length;
            registerCert(_rootCerts[i]);
            emit CertificateRegistered(_rootCerts[i]);
        }
        
        initialized = true;
        emit CertificateRegistryInitialized();
        
        return 200;
    }
    
    function registerCertificate(string newCertificateString) returns (int) {
        require(initialized, "You must first initialize with initializeCertificateRegistry!");
        
        mapping(string => string) parsedCert = parseCert(newCertificateString);
        address parentUserAddress = address(parsedCert["parent"]);
        Certificate parentContract = certificates[certificatesMap[parentUserAddress]-1];
        
        if (parentContract.isValid() && verifyCertSignedBy(newCertificateString, parentContract.publicKey())){
            // Create the new Certificate record
            Certificate c = new Certificate(newCertificateString);

            if (parentUserAddress != address(0x0)){
                parentContract.addChild(c.userAddress());    
            }

            certificates.push(c);
            certificatesMap[c.userAddress()] = certificates.length;
            
            registerCert(newCertificateString);
            emit CertificateRegistered(newCertificateString);
    
            return 200; // 200 = HTTP Status OK
        }
        return 400;
    }

    function getUserCert(address _address) returns (address) {
        return certificates[certificatesMap[account(_address)]];
    }
    
    function getCertByAddress(address _address) returns (Certificate) {
        return getCertByAccount(account(_address));
    }
    
    function getCertByAccount(address _account) returns (Certificate) {
        return certificates[certificatesMap[_account]-1];
    }
    
    function revokeCert(address userAddress){
        Certificate myCert = certificates[certificatesMap[userAddress]-1];
        require(isChild(tx.certificate, myCert.userAddress()), "You don't have permission to revoke!");

        int childrenLength = myCert.revoke();
        for (int i = 0; i < childrenLength; i += 1) {
            revokeCert(myCert.getChild(i));
        }
        
        emit CertificateRevoked(userAddress);
    }
    
    function isChild(string pCert, address certUserAddress) returns (bool) {
        Certificate myCert = certificates[certificatesMap[certUserAddress]-1];
        address parentUserAddress = myCert.parent();
        if(myCert.parent() != address(0x0) && pCert == certificates[certificatesMap[parentUserAddress]-1].certificateString()){
            return true;
        }
        
        if(myCert.parent() != address(0x0)){
            return isChild(pCert, parentUserAddress);
        }
        
        return false;
    }
}|]
