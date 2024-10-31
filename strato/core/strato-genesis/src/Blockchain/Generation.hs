{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE TupleSections #-}

module Blockchain.Generation
  ( encodeAllRecords,
    encodeJSON,
    encodeJSONHashMaps,
    insertContractsCount,
    insertContractsJSON,
    insertContractsJSONHashMaps,
    insertContracts,
    insertCertRegistryContract,
    insertUserRegistryContract,
    insertMercataGovernanceContract,
    readCertsFromGenesisInfo,
    readValidatorsFromGenesisInfo,
    Records (..),
    RecordsHashMap (..),
    Type (..),
    TypeHashMap (..),
  )
where

import BlockApps.X509.Certificate
import BlockApps.X509.Keys (pubToBytes, rootPubKey)
import Blockchain.Data.ChainInfo
import Blockchain.Data.GenesisInfo
import Blockchain.Data.RLP
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.CodePtr
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Validator (Validator(..))
import qualified Blockchain.Strato.Model.Keccak256 as KECCAK256
import Blockchain.Strato.Model.UserRegistry
import qualified Data.Aeson as Ae
import qualified Data.Aeson.Key as DAK
import qualified Data.Aeson.KeyMap as KM
import qualified Data.Bifunctor as BF
import Data.Bits
import qualified Data.ByteString as BS
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import qualified Data.ByteString.Lazy as L
import qualified Data.JsonStream.Parser as JS
import qualified Data.List as List
import qualified Data.Map.Strict as M
import Data.Maybe
import Data.Scientific (floatingOrInteger)
import Data.Text (Text)
import Data.Text.Encoding
import qualified Data.Vector as V
import GHC.Generics
import SolidVM.Model.Storable hiding (size)
import SolidVM.Model.Value
import Text.RawString.QQ

data Type
  = Number Integer
  | Stryng Text
  | List (V.Vector Type)
  | Struct [Type]
  | -- TODO(tim): Make the key type generic over hashable things.
    Mapping (KM.KeyMap Type)
  deriving (Eq, Show, Generic)

instance Ae.FromJSON Type where
  parseJSON (Ae.String s) = return . Stryng $ s
  parseJSON (Ae.Number x) = case floatingOrInteger x :: Either Double Integer of
    Left f -> fail $ "must be int or string: " ++ show f
    Right n -> return . Number $ n
  parseJSON (Ae.Array as) = List <$> V.mapM Ae.parseJSON as
  parseJSON (Ae.Object ss) =
    let a `cmp` b = fst a `compare` fst b
     in Struct <$> (mapM (Ae.parseJSON . snd) . List.sortBy cmp . KM.toList $ ss)
  parseJSON (Ae.Bool b) = return . Number $ if b then 1 else 0
  parseJSON _ = fail "unknown aeson type"

-- This is a clumsy hack to just create a mapping(bytes32 => uint),
-- and probably needs to be replaced with something more generic.
-- For example, this prohibits mapping(address => mapping(address => bool)),
-- both because it only uses a string key and because the values is not Type2
data TypeHashMap = Type Type | MappingHashMap (KM.KeyMap Type) deriving (Eq, Show, Generic)

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
equalChunksOf n ws
  | BS.length ws == 0 = []
  | BS.length ws <= n = [ws <> BS.replicate (n - BS.length ws) 0]
  | otherwise =
    let (car, cdr) = BS.splitAt n ws
     in car : (equalChunksOf n cdr)

hash :: Word256 -> Word256
hash = bytesToWord256 . KECCAK256.keccak256ToByteString . KECCAK256.hash . word256ToBytes

encodeSequentially :: Word256 -> [Type] -> ([(Word256, Word256)], Word256)
encodeSequentially k [] = ([], k)
encodeSequentially k (t : ts) =
  let (tSlots, k') = encodeType k t
      (tsSlots, k'') = encodeSequentially k' ts
   in (tSlots ++ tsSlots, k'')

mapHash :: Word256 -> Word256 -> Word256
mapHash x y = bytesToWord256 . KECCAK256.keccak256ToByteString $ KECCAK256.hash $ word256ToBytes x <> word256ToBytes y

-- First return value is the slots for this value, and the second return value
-- is the next available slot.
encodeType :: Word256 -> Type -> ([(Word256, Word256)], Word256)
encodeType k (Number n)
  | n >= 0 && n <= (2 ^ (256 :: Integer)) = ([(k, fromIntegral n)], k + 1)
  | otherwise = error "unimplemented for negative numbers"
encodeType k (Stryng s) =
  if BS.length payload < 32
    then
      let pad = BS.replicate (31 - BS.length payload) 0
          size = BS.singleton . fromIntegral $ BS.length payload `shiftL` 1
       in ([(k, bytesToWord256 $ payload <> pad <> size)], k + 1)
    else
      let size = fromIntegral $ (BS.length payload `shiftL` 1) .|. 1
          pointer = (k, size)
          start = hash k
          packets = zip (map (start +) [0 ..]) . map bytesToWord256 . equalChunksOf 32 $ payload
       in (pointer : packets, k + 1)
  where
    payload = encodeUtf8 s
encodeType k (List payload) =
  let size = fromIntegral . length $ payload
      pointer = (k, size)
      start = hash k
      (packets, _) = encodeSequentially start (V.toList payload)
   in (pointer : packets, k + 1)
encodeType k (Struct ts) = encodeSequentially k ts
encodeType p (Mapping hm) =
  let pointer = (p, 0)
      -- This is very specific to the case of using bytes32 as keys.
      -- Using strings as key hashes the whole string, rather than
      -- slicing to 32 bytes and extending by 0s.
      payload s =
        let raw = encodeUtf8 s
         in if BS.length raw < 33
              then raw <> BS.replicate (32 - BS.length raw) 0
              else BS.take 32 raw
      -- For a mapping value located in contract slot p with key s
      -- the slot is keccak256(s <> p)
      trieKey s = mapHash (bytesToWord256 . payload $ s) p
      place (s, v) = fst . encodeType (trieKey s) $ v
   in (pointer : (concatMap place . fmap (BF.first DAK.toText) . KM.toList $ hm), p + 1)

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
      mkContract (addr, slots) = ContractWithStorage addr 0 (ExternallyOwned codeHash) slots
      addrs = map (start +) [0 ..]
      addrsAndSlots = zip addrs slotss
   in gi
        { genesisInfoAccountInfo = initialAccounts ++ map mkContract addrsAndSlots,
          genesisInfoCodeInfo = initialCode ++ [CodeInfo decoded src $ Just name]
        }

readCertsFromGenesisInfo :: GenesisInfo -> [X509Certificate]
readCertsFromGenesisInfo gi = catMaybes . flip map (genesisInfoAccountInfo gi) $ \case
  SolidVMContractWithStorage _ _ (SolidVMCode "Certificate" _) storage -> do
    let storageMap = M.fromList storage
        rlpUnwrap = rlpDecode . rlpDeserialize
    certStr <- rlpUnwrap <$> M.lookup ".certificateString" storageMap
    case certStr of
      BString certStr' -> either (const Nothing) Just $ bsToCert certStr'
      _ -> Nothing
  _ -> Nothing

readValidatorsFromGenesisInfo :: GenesisInfo -> [Validator]
readValidatorsFromGenesisInfo gi = catMaybes . flip map (genesisInfoAccountInfo gi) $ \case
  SolidVMContractWithStorage _ _ (SolidVMCode "MercataValidator" _) storage -> do
    let storageMap = M.fromList storage
        rlpUnwrap = rlpDecode . rlpDeserialize
    c <- rlpUnwrap <$> M.lookup ".commonName" storageMap
    case c of
      BString c' -> do
        pure $ (Validator $ decodeUtf8 c')
      _ -> Nothing
  _ -> Nothing

-- | Inserts a Certificate Registry contract into the genesis block with the BlockApps root cert as owner
-- | Accepts a list of X509 certificates, if there are any that need to be initialized at init besides root
insertCertRegistryContract :: [X509Certificate] -> GenesisInfo -> GenesisInfo
insertCertRegistryContract certs gi =
  gi
    { genesisInfoAccountInfo = initialAccounts ++ registryAcct : rootAcct : certAccts,
      genesisInfoCodeInfo = initialCode ++ [CodeInfo encodedRegistry certificateRegistryContract (Just "CertificateRegistry")]
    }
  where
    initialAccounts = genesisInfoAccountInfo gi
    initialCode = genesisInfoCodeInfo gi

    rlpWrap = rlpSerialize . rlpEncode
    encodedRegistry = encodeUtf8 certificateRegistryContract

    rootAddress' = fromPublicKey rootPubKey
    rootAddress = rlpWrap $ BAccount (NamedAccount rootAddress' UnspecifiedChain)
    rootSub = fromJust $ getCertSubject rootCert

    certSub' crt =
      case getCertSubject crt of
        Just s -> s
        Nothing -> error "Certificate requires a subject"
    maybeCertField = fromMaybe ""
    certUserAddress = fromPublicKey . subPub . certSub'
    rootAcct =
      SolidVMContractWithStorage
        0x1337
        1337
        (SolidVMCode "Certificate" (KECCAK256.hash encodedRegistry))
        [ (".owner", rlpWrap $ BAccount (NamedAccount ((fromJust . stringAddress) "509") UnspecifiedChain)),
          (".userAddress", rlpWrap $ BAccount (NamedAccount (fromPublicKey . subPub $ rootSub) UnspecifiedChain)),
          (".commonName", rlpWrap . BString . BC.pack . subCommonName $ rootSub),
          (".country", rlpWrap . BString . BC.pack . fromJust . subCountry $ rootSub),
          (".organization", rlpWrap . BString . BC.pack . subOrg $ rootSub),
          (".group", rlpWrap . BString . BC.pack . fromJust . subUnit $ rootSub),
          (".organizationalUnit", rlpWrap . BString . BC.pack . fromJust . subUnit $ rootSub),
          (".publicKey", rlpWrap . BString . pubToBytes . subPub $ rootSub),
          (".certificateString", rlpWrap . BString $ certToBytes rootCert),
          (".isValid", rlpWrap (BBool True)),
          (".parent", rlpWrap $ BAccount (NamedAccount (Address 0x0) UnspecifiedChain))
        ]

    -- Reversing the cert user address to create a placeholder Certificate contract address
    reverseAddr = Address . bytesToWord160 . reverse . word160ToBytes . unAddress . certUserAddress
    addrToCertIdx ad = rlpWrap $ BAccount (NamedAccount (fromJust . stringAddress $ ad) UnspecifiedChain)
    registryAcct =
      SolidVMContractWithStorage
        0x509
        509
        (SolidVMCode "CertificateRegistry" (KECCAK256.hash encodedRegistry))
        $ [ (".owner", rootAddress),
            (BC.pack $ ".addressToCertMap<a:" ++ show rootAddress' ++ ">", addrToCertIdx "1337")
          ]
          ++ map (\c -> (BC.pack $ ".addressToCertMap<a:" ++ show (certUserAddress c) ++ ">", addrToCertIdx . show . reverseAddr $ c)) certs

    certAccts =
      map
        ( \cert -> do
            let certSub = certSub' cert
            SolidVMContractWithStorage
              (reverseAddr cert)
              0
              (SolidVMCode "Certificate" (KECCAK256.hash encodedRegistry))
              [ (".owner", rlpWrap $ BAccount (NamedAccount ((fromJust . stringAddress) "509") UnspecifiedChain)),
                (".userAddress", rlpWrap $ BAccount (NamedAccount (fromPublicKey . subPub $ certSub) UnspecifiedChain)),
                (".commonName", rlpWrap . BString . BC.pack . subCommonName $ certSub),
                (".country", rlpWrap . BString . BC.pack . maybeCertField . subCountry $ certSub),
                (".organization", rlpWrap . BString . BC.pack . subOrg $ certSub),
                (".group", rlpWrap . BString . BC.pack . maybeCertField . subUnit $ certSub),
                (".organizationalUnit", rlpWrap . BString . BC.pack . maybeCertField . subUnit $ certSub),
                (".publicKey", rlpWrap . BString . pubToBytes . subPub $ certSub),
                (".certificateString", rlpWrap . BString $ certToBytes cert),
                (".isValid", rlpWrap (BBool True)),
                (".parent", rlpWrap $ BAccount (NamedAccount (fromMaybe (Address 0x0) $ getParentUserAddress cert) UnspecifiedChain))
              ]
        )
        certs

certificateRegistryContract :: Text
certificateRegistryContract =
  [r|
contract Certificate {
    address owner;  // The CertificateRegistry Contract

    address public userAddress;
    address public parent;
    address[] public children;

    
    // Store all the fields of a certificate in a Cirrus record
    string public commonName;
    string public country;
    string public organization;
    string public group;
    string public organizationalUnit;
    string public publicKey;
    string public certificateString;
    bool public isValid;

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

contract CertificateRegistry {
    // The registry maintains a list and mapping of all the certificates
    // We need the extra array in order for us to iterate through our certificates.
    // Solidity mappings are non-iterable.
    mapping(address => address) addressToCertMap;
    address public owner;

    event CertificateRegistered(string certificate);
    event CertificateRevoked(address userAddress);
    
    function registerCertificate(string newCertificateString) returns (int) {
        mapping(string => string) parsedCert = parseCert(newCertificateString);
        address parentUserAddress = address(parsedCert["parent"]);
        Certificate parentContract = Certificate(addressToCertMap[account(parentUserAddress)]);
        
        if (address(parentContract) != address(0) && parentContract.isValid() && verifyCertSignedBy(newCertificateString, parentContract.publicKey())) {
            // Create the new Certificate record
            Certificate c = new Certificate(newCertificateString);

            if (parentUserAddress != address(0x0)){
                parentContract.addChild(c.userAddress());    
            }

            addressToCertMap[c.userAddress()] = address(c);
            emit CertificateRegistered(newCertificateString);
            return 200; // 200 = HTTP Status OK
        }
        return 400;
    }

    function getUserCert(address _address) returns (Certificate) {
        return Certificate(addressToCertMap[account(_address)]);
    }
    
    function getCertByAddress(address _address) returns (Certificate) {
        return Certificate(getCertByAccount(account(_address)));
    }
    
    function getCertByAccount(address _account) returns (Certificate) {
        return Certificate(addressToCertMap[account(_account)]);
    }
    
    function revokeCert(address userAddress){
        Certificate myCert = Certificate(addressToCertMap[account(userAddress)]);
        require(isChild(tx.certificate, myCert.userAddress()), "You don't have permission to revoke!");

        int childrenLength = myCert.revoke();
        for (int i = 0; i < childrenLength; i += 1) {
            revokeCert(myCert.getChild(i));
        }
        
        emit CertificateRevoked(userAddress);
    }
    
    function isChild(string pCert, address certUserAddress) returns (bool) {
        Certificate myCert = Certificate(addressToCertMap[account(certUserAddress)]);
        address parentUserAddress = myCert.parent();
        if(myCert.parent() != address(0x0) && pCert ==  Certificate(addressToCertMap[account(parentUserAddress)]).certificateString()){
            return true;
        }
        
        if(myCert.parent() != address(0x0)){
            return isChild(pCert, parentUserAddress);
        }
        
        return false;
    }
}|]

-- | Inserts a Governance contract into the genesis block with the BlockApps root cert as owner
insertMercataGovernanceContract :: [ChainMemberParsedSet] -> [ChainMemberParsedSet] -> GenesisInfo -> GenesisInfo
insertMercataGovernanceContract validators admins gi =
  gi
    { genesisInfoAccountInfo = initialAccounts ++ govAcct : (validatorAccts ++ adminAccts),
      genesisInfoCodeInfo = initialCode ++ [CodeInfo encodedGovernance governanceSrc (Just "MercataGovernance")]
    }
  where
    initialAccounts = genesisInfoAccountInfo gi
    initialCode = genesisInfoCodeInfo gi

    rlpWrap = rlpSerialize . rlpEncode
    governanceSrc = certificateRegistryContract <> "\n\n" <> mercataGovernanceContract
    encodedGovernance = encodeUtf8 governanceSrc

    rootAddress' = fromPublicKey rootPubKey
    rootAddress = rlpWrap $ BAccount (NamedAccount rootAddress' MainChain)
    addrToCertIdx ad = rlpWrap $ BAccount (NamedAccount (fromJust . stringAddress $ ad) MainChain)
    valIx = zip [0 ..] validators
    adminIx = zip [0 ..] admins
    validatorOffset = 0x56616c696461746f7273
    adminOffset = 0x41646d696e73
    validatorAddr i = Address . fromInteger $ validatorOffset + i
    adminAddr i = Address . fromInteger $ adminOffset + i
    govAcct =
      SolidVMContractWithStorage
        0x100
        0x426c6f636b61707073205374617274696e6672042616c616e6365
        (SolidVMCode "MercataGovernance" (KECCAK256.hash encodedGovernance))
        $ [ (".owner", rootAddress),
            (".validatorCount", rlpWrap . BInteger . toInteger $ length validators),
            (".adminCount", rlpWrap . BInteger . toInteger $ length admins)
          ]
          -- ++ map (\(i, CommonName o u c True) ->
          --          ( encodeUtf8 $ ".validatorMap<\"" <> o <> "\"><\"" <> u <> "\"><\"" <> c <> "\">"
          --          , addrToCertIdx . show $ validatorAddr i)) valIx
          -- ++ map (\(i, CommonName o u c True) ->
          --          ( encodeUtf8 $ ".adminMap<\"" <> o <> "\"><\"" <> u <> "\"><\"" <> c <> "\">"
          --          , addrToCertIdx . show $ adminAddr i)) adminIx
          ++ map
            ( \case
                (i, CommonName o u c True) ->
                  ( encodeUtf8 $ ".validatorMap<\"" <> o <> "\"><\"" <> u <> "\"><\"" <> c <> "\">",
                    addrToCertIdx . show $ validatorAddr i
                  )
                _ -> error "Invalid validator cert"
            )
            valIx
          ++ map
            ( \case
                (i, CommonName o u c True) ->
                  ( encodeUtf8 $ ".adminMap<\"" <> o <> "\"><\"" <> u <> "\"><\"" <> c <> "\">",
                    addrToCertIdx . show $ adminAddr i
                  )
                _ -> error "Invalid admin cert"
            )
            adminIx
    validatorAccts =
      map
        ( \case
            (i, CommonName o u c True) ->
              SolidVMContractWithStorage
                (validatorAddr i)
                0
                (SolidVMCode "MercataValidator" (KECCAK256.hash encodedGovernance))
                [ (".owner", rlpWrap $ BAccount (NamedAccount ((fromJust . stringAddress) "100") MainChain)),
                  (".org", rlpWrap . BString $ encodeUtf8 o),
                  (".orgUnit", rlpWrap . BString $ encodeUtf8 u),
                  (".commonName", rlpWrap . BString $ encodeUtf8 c),
                  (".isActive", rlpWrap $ BBool True)
                ]
            _ -> error "Invalid validator cert"
        )
        valIx
    adminAccts =
      map
        ( \case
            (i, CommonName o u c True) ->
              SolidVMContractWithStorage
                (adminAddr i)
                0
                (SolidVMCode "MercataAdmin" (KECCAK256.hash encodedGovernance))
                [ (".owner", rlpWrap $ BAccount (NamedAccount ((fromJust . stringAddress) "100") MainChain)),
                  (".org", rlpWrap . BString $ encodeUtf8 o),
                  (".orgUnit", rlpWrap . BString $ encodeUtf8 u),
                  (".commonName", rlpWrap . BString $ encodeUtf8 c),
                  (".isActive", rlpWrap $ BBool True)
                ]
            _ -> error "Invalid admin cert"
        )
        adminIx

mercataGovernanceContract :: Text
mercataGovernanceContract =
  [r|
contract MercataValidator {
    address public owner;

    string public org;
    string public orgUnit;
    string public commonName;

    bool public isActive;

    uint public votedInTime;
    uint public votedOutTime;

    constructor(string _org, string _orgUnit, string _commonName) {
        owner = msg.sender;
        org = _org;
        orgUnit = _orgUnit;
        commonName = _commonName;
        isActive = true;
        votedInTime = block.timestamp;
    }

    function deactivate() {
        require(msg.sender == owner, "Only the contract's owner can call deactivate.");
        isActive = false;
        votedOutTime = block.timestamp;
    }
}

contract MercataAdmin {
    address public owner;

    string public org;
    string public orgUnit;
    string public commonName;

    bool public isActive;

    uint public votedInTime;
    uint public votedOutTime;

    constructor(string _org, string _orgUnit, string _commonName) {
        owner = msg.sender;
        org = _org;
        orgUnit = _orgUnit;
        commonName = _commonName;
        isActive = true;
        votedInTime = block.timestamp;
    }

    function deactivate() {
        require(msg.sender == owner, "Only the contract's owner can call deactivate.");
        isActive = false;
        votedOutTime = block.timestamp;
    }
}

contract MercataValidatorVote {

    address public owner;

    string public recipientOrg;
    string public recipientOrgUnit;
    string public recipientCommonName;

    string public voterOrg;
    string public voterOrgUnit;
    string public voterCommonName;

    bool public voteDirection;

    bool public isActive;
    bool public isFinal;

    uint public voteTimestamp;
    uint public deactivationTimestamp;
    uint public finalizationTimestamp;

    constructor(string _voterOrg, string _voterOrgUnit, string _voterCommonName,
                string _recipientOrg, string _recipientOrgUnit, string _recipientCommonName,
                bool _voteDirection) {
        owner = msg.sender;
        voterOrg = _voterOrg;
        voterOrgUnit = _voterOrgUnit;
        voterCommonName = _voterCommonName;
        recipientOrg = _recipientOrg;
        recipientOrgUnit = _recipientOrgUnit;
        recipientCommonName = _recipientCommonName;
        voteDirection = _voteDirection;
        isActive = true;
        voteTimestamp = block.timestamp;
    }

    function deactivate() {
        require(msg.sender == owner, "Only the contract's owner can call deactivate.");
        isActive = false;
        deactivationTimestamp = block.timestamp;
    }

    function changeVote(bool _voteDirection) {
        require(msg.sender == owner, "Only the contract's owner can call deactivate.");
        voteDirection = _voteDirection;
        voteTimestamp = block.timestamp;
    }

    function finalize() {
        require(msg.sender == owner, "Only the contract's owner can call deactivate.");
        isActive = false;
        isFinal = true;
        deactivationTimestamp = block.timestamp;
        finalizationTimestamp = block.timestamp;
    }
}

contract MercataAdminVote {

    address public owner;

    string public recipientOrg;
    string public recipientOrgUnit;
    string public recipientCommonName;

    string public voterOrg;
    string public voterOrgUnit;
    string public voterCommonName;

    bool public voteDirection;

    bool public isActive;
    bool public isFinal;

    uint public voteTimestamp;
    uint public deactivationTimestamp;
    uint public finalizationTimestamp;

    constructor(string _voterOrg, string _voterOrgUnit, string _voterCommonName,
                string _recipientOrg, string _recipientOrgUnit, string _recipientCommonName,
                bool _voteDirection) {
        owner = msg.sender;
        voterOrg = _voterOrg;
        voterOrgUnit = _voterOrgUnit;
        voterCommonName = _voterCommonName;
        recipientOrg = _recipientOrg;
        recipientOrgUnit = _recipientOrgUnit;
        recipientCommonName = _recipientCommonName;
        voteDirection = _voteDirection;
        isActive = true;
        voteTimestamp = block.timestamp;
    }

    function deactivate() {
        require(msg.sender == owner, "Only the contract's owner can call deactivate.");
        isActive = false;
        deactivationTimestamp = block.timestamp;
    }

    function finalize() {
        require(msg.sender == owner, "Only the contract's owner can call deactivate.");
        isActive = false;
        isFinal = true;
        deactivationTimestamp = block.timestamp;
        finalizationTimestamp = block.timestamp;
    }
}

contract MercataGovernance {
    mapping (string => mapping (string => mapping (string => MercataValidator))) validatorMap;
    uint validatorCount;

    mapping (string => mapping (string => mapping (string => MercataAdmin))) adminMap;
    uint adminCount;

    mapping (string => mapping (string => mapping (string => mapping (string => mapping (string => mapping (string => uint)))))) validatorVoteMap;
    mapping (string => mapping (string => mapping (string => MercataValidatorVote[]))) validatorVotes;
    mapping (string => mapping (string => mapping (string => uint))) validatorVoteCountMap;

    mapping (string => mapping (string => mapping (string => mapping (string => mapping (string => mapping (string => uint)))))) adminVoteMap;
    mapping (string => mapping (string => mapping (string => MercataAdminVote[]))) adminVotes;
    mapping (string => mapping (string => mapping (string => uint))) adminVoteCountMap;

    address public owner;

    event ValidatorAdded(string org, string orgUnit, string commonName);
    event ValidatorRemoved(string org, string orgUnit, string commonName);
    
    function voteToAddValidator(string _org, string _orgUnit, string _commonName) {
        Certificate c = CertificateRegistry(address(0x509)).getUserCert(tx.origin);
        require(address(c) != address(0), "Voting to add a validator requires having a valid X.509 certificate");
        require(c.isValid(), "Voting to add a validator requires having a valid X.509 certificate");
        string originOrg = c.organization();
        string originUnit = c.organizationalUnit();
        string originName = c.commonName();

        MercataAdmin a = adminMap[originOrg][originUnit][originName];
        require(address(a) != address(0), "Only registered network admins can vote for validators");
        require(a.isActive(), "Only registered network admins can vote for validators");
        
        MercataValidator v = validatorMap[_org][_orgUnit][_commonName];
        require(address(v) == address(0), "Votes to add cannot be counted for current validators");
        
        uint voteIndex = validatorVoteMap[_org][_orgUnit][_commonName][originOrg][originUnit][originName];
        require(voteIndex == 0, "Vote to add already cast for " + _org + " " + _orgUnit + " " + _commonName);
        MercataValidatorVote newVote = new MercataValidatorVote(originOrg, originUnit, originName, _org, _orgUnit, _commonName, true);
        uint voteCount = validatorVoteCountMap[_org][_orgUnit][_commonName] + 1;
        validatorVoteCountMap[_org][_orgUnit][_commonName] = voteCount;
        validatorVotes[_org][_orgUnit][_commonName].push(newVote);
        validatorVoteMap[_org][_orgUnit][_commonName][originOrg][originUnit][originName] = validatorVotes[_org][_orgUnit][_commonName].length;

        uint newVoteCount = validatorVoteCountMap[_org][_orgUnit][_commonName];
        if (newVoteCount >= ((2 * adminCount) / 3) + 1) {
            MercataValidatorVote[] votes = validatorVotes[_org][_orgUnit][_commonName];
            for (uint i = 0; i < votes.length; i++) {
                votes[i].finalize();
                string voteOrg = votes[i].voterOrg();
                string voteUnit = votes[i].voterOrgUnit();
                string voteName = votes[i].voterCommonName();
                validatorVoteMap[_org][_orgUnit][_commonName][voteOrg][voteUnit][voteName] = 0;
                votes[i] = MercataValidatorVote(address(0));
            }
            validatorVotes[_org][_orgUnit][_commonName].length = 0;
            validatorVoteCountMap[_org][_orgUnit][_commonName] = 0;
            MercataValidator newValidator = new MercataValidator(_org, _orgUnit, _commonName);
            validatorMap[_org][_orgUnit][_commonName] = newValidator;
            validatorCount++;
            emit ValidatorAdded(_org, _orgUnit, _commonName);
        }
    }
    
    function voteToRemoveValidator(string _org, string _orgUnit, string _commonName) {
        Certificate c = CertificateRegistry(address(0x509)).getUserCert(tx.origin);
        require(address(c) != address(0), "Voting to add a validator requires having a valid X.509 certificate");
        require(c.isValid(), "Voting to add a validator requires having a valid X.509 certificate");
        string originOrg = c.organization();
        string originUnit = c.organizationalUnit();
        string originName = c.commonName();

        MercataAdmin a = adminMap[originOrg][originUnit][originName];
        require(address(a) != address(0), "Only registered network admins can vote for validators");
        require(a.isActive(), "Only registered network admins can vote for validators");
        
        MercataValidator v = validatorMap[_org][_orgUnit][_commonName];
        require(address(v) != address(0), "Votes to remove can only be counted for current validators");
        
        uint voteIndex = validatorVoteMap[_org][_orgUnit][_commonName][originOrg][originUnit][originName];
        require(voteIndex == 0, "Vote to add already cast for " + _org + " " + _orgUnit + " " + _commonName);
        MercataValidatorVote newVote = new MercataValidatorVote(originOrg, originUnit, originName, _org, _orgUnit, _commonName, false);
        uint voteCount = validatorVoteCountMap[_org][_orgUnit][_commonName] + 1;
        validatorVoteCountMap[_org][_orgUnit][_commonName] = voteCount;
        validatorVotes[_org][_orgUnit][_commonName].push(newVote);
        validatorVoteMap[_org][_orgUnit][_commonName][originOrg][originUnit][originName] = validatorVotes[_org][_orgUnit][_commonName].length;

        uint newVoteCount = validatorVoteCountMap[_org][_orgUnit][_commonName];
        if (newVoteCount >= ((2 * adminCount) / 3) + 1) {
            MercataValidatorVote[] votes = validatorVotes[_org][_orgUnit][_commonName];
            for (uint i = 0; i < votes.length; i++) {
                votes[i].finalize();
                string voteOrg = votes[i].voterOrg();
                string voteUnit = votes[i].voterOrgUnit();
                string voteName = votes[i].voterCommonName();
                validatorVoteMap[_org][_orgUnit][_commonName][voteOrg][voteUnit][voteName] = 0;
                votes[i] = MercataValidatorVote(address(0));
            }
            validatorVotes[_org][_orgUnit][_commonName].length = 0;
            validatorVoteCountMap[_org][_orgUnit][_commonName] = 0;
            v.deactivate();
            validatorMap[_org][_orgUnit][_commonName] = MercataValidator(address(0));
            validatorCount--;
            emit ValidatorRemoved(_org, _orgUnit, _commonName);
        }
    }
    
    function voteToAddAdmin(string _org, string _orgUnit, string _commonName) {
        Certificate c = CertificateRegistry(address(0x509)).getUserCert(tx.origin);
        require(address(c) != address(0), "Voting to add a network admin requires having a valid X.509 certificate");
        require(c.isValid(), "Voting to add an admin requires having a valid X.509 certificate");
        string originOrg = c.organization();
        string originUnit = c.organizationalUnit();
        string originName = c.commonName();

        MercataAdmin a = adminMap[originOrg][originUnit][originName];
        require(address(a) != address(0), "Only registered network admins can vote for admins");
        require(a.isActive(), "Only registered network admins can vote for admins");
        
        MercataAdmin v = adminMap[_org][_orgUnit][_commonName];
        require(address(v) == address(0), "Votes to add cannot be counted for current admins");
        
        uint voteIndex = adminVoteMap[_org][_orgUnit][_commonName][originOrg][originUnit][originName];
        require(voteIndex == 0, "Vote to add already cast for " + _org + " " + _orgUnit + " " + _commonName);
        MercataAdminVote newVote = new MercataAdminVote(originOrg, originUnit, originName, _org, _orgUnit, _commonName, true);
        uint voteCount = adminVoteCountMap[_org][_orgUnit][_commonName] + 1;
        adminVoteCountMap[_org][_orgUnit][_commonName] = voteCount;
        adminVotes[_org][_orgUnit][_commonName].push(newVote);
        adminVoteMap[_org][_orgUnit][_commonName][originOrg][originUnit][originName] = adminVotes[_org][_orgUnit][_commonName].length;

        uint newVoteCount = adminVoteCountMap[_org][_orgUnit][_commonName];
        if (newVoteCount >= ((2 * adminCount) / 3) + 1) {
            MercataAdminVote[] votes = adminVotes[_org][_orgUnit][_commonName];
            for (uint i = 0; i < votes.length; i++) {
                votes[i].finalize();
                string voteOrg = votes[i].voterOrg();
                string voteUnit = votes[i].voterOrgUnit();
                string voteName = votes[i].voterCommonName();
                adminVoteMap[_org][_orgUnit][_commonName][voteOrg][voteUnit][voteName] = 0;
                votes[i] = MercataAdminVote(address(0));
            }
            adminVotes[_org][_orgUnit][_commonName].length = 0;
            adminVoteCountMap[_org][_orgUnit][_commonName] = 0;
            MercataAdmin newAdmin = new MercataAdmin(_org, _orgUnit, _commonName);
            adminMap[_org][_orgUnit][_commonName] = newAdmin;
            adminCount++;
        }
    }
    
    function voteToRemoveAdmin(string _org, string _orgUnit, string _commonName) {
        Certificate c = CertificateRegistry(address(0x509)).getUserCert(tx.origin);
        require(address(c) != address(0), "Voting to add an admin requires having a valid X.509 certificate");
        require(c.isValid(), "Voting to add an admin requires having a valid X.509 certificate");
        string originOrg = c.organization();
        string originUnit = c.organizationalUnit();
        string originName = c.commonName();

        MercataAdmin a = adminMap[originOrg][originUnit][originName];
        require(address(a) != address(0), "Only registered network admins can vote for admins");
        require(a.isActive(), "Only registered network admins can vote for admins");
        
        MercataAdmin v = adminMap[_org][_orgUnit][_commonName];
        require(address(v) != address(0), "Votes to remove can only be counted for current admins");
        
        uint voteIndex = adminVoteMap[_org][_orgUnit][_commonName][originOrg][originUnit][originName];
        require(voteIndex == 0, "Vote to add already cast for " + _org + " " + _orgUnit + " " + _commonName);
        MercataAdminVote newVote = new MercataAdminVote(originOrg, originUnit, originName, _org, _orgUnit, _commonName, false);
        uint voteCount = adminVoteCountMap[_org][_orgUnit][_commonName] + 1;
        adminVoteCountMap[_org][_orgUnit][_commonName] = voteCount;
        adminVotes[_org][_orgUnit][_commonName].push(newVote);
        adminVoteMap[_org][_orgUnit][_commonName][originOrg][originUnit][originName] = adminVotes[_org][_orgUnit][_commonName].length;

        uint newVoteCount = adminVoteCountMap[_org][_orgUnit][_commonName];
        if (newVoteCount >= ((2 * adminCount) / 3) + 1) {
            MercataAdminVote[] votes = adminVotes[_org][_orgUnit][_commonName];
            for (uint i = 0; i < votes.length; i++) {
                votes[i].finalize();
                string voteOrg = votes[i].voterOrg();
                string voteUnit = votes[i].voterOrgUnit();
                string voteName = votes[i].voterCommonName();
                adminVoteMap[_org][_orgUnit][_commonName][voteOrg][voteUnit][voteName] = 0;
                votes[i] = MercataAdminVote(address(0));
            }
            adminVotes[_org][_orgUnit][_commonName].length = 0;
            adminVoteCountMap[_org][_orgUnit][_commonName] = 0;
            v.deactivate();
            adminMap[_org][_orgUnit][_commonName] = MercataAdmin(address(0));
            adminCount--;
        }
    }
}|]

-- | Inserts a User Registry contract into the genesis block with the BlockApps root cert as owner
insertUserRegistryContract :: [X509Certificate] -> GenesisInfo -> GenesisInfo
insertUserRegistryContract certs gi =
  gi
    { genesisInfoAccountInfo = initialAccounts ++ [registryAcct, rootAcct] ++ userAccts,
      genesisInfoCodeInfo = initialCode ++ [CodeInfo encodedRegistry userRegistryContract (Just "UserRegistry")]
    }
  where
    initialAccounts = genesisInfoAccountInfo gi
    initialCode = genesisInfoCodeInfo gi

    rlpWrap = rlpSerialize . rlpEncode
    encodedRegistry = encodeUtf8 userRegistryContract

    rootSub = fromJust $ getCertSubject rootCert
    rootAcct =
      SolidVMContractWithStorage
        (deriveAddressWithSalt Nothing (subCommonName rootSub) Nothing (Just . show $ OrderedVals [SString $ subCommonName rootSub]))
        123
        (SolidVMCode "User" (KECCAK256.hash encodedRegistry))
        [ (".commonName", rlpWrap . BString . BC.pack . subCommonName $ rootSub)
        ]

    userAccts =
      map
        ( \cert -> do
            let certSub' crt =
                  case getCertSubject crt of
                    Just s -> s
                    Nothing -> error "Certificate requires a subject"
                certSub = certSub' cert
            SolidVMContractWithStorage
              (deriveAddressWithSalt Nothing (subCommonName certSub) Nothing (Just . show $ OrderedVals [SString $ subCommonName certSub]))
              0
              (SolidVMCode "User" (KECCAK256.hash encodedRegistry))
              [ (".commonName", rlpWrap . BString . BC.pack . subCommonName $ certSub)
              ]
        )
        certs

    registryAcct =
      SolidVMContractWithStorage
        0x720
        720
        (SolidVMCode "UserRegistry" (KECCAK256.hash encodedRegistry))
        $ []
