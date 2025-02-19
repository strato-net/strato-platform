{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}

module Blockchain.GenesisBlocks.Contracts.GovernanceV2 (
  insertMercataGovernanceContract
  ) where

import BlockApps.X509.Keys (rootPubKey)
import Blockchain.Data.GenesisInfo
import Blockchain.GenesisBlocks.Contracts.CertRegistry
import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.CodePtr
import qualified Blockchain.Strato.Model.Keccak256 as KECCAK256
import Data.Maybe
import Data.Text (Text)
import Data.Text.Encoding
import SolidVM.Model.Storable hiding (size)
import Text.RawString.QQ

-- | Inserts a Governance contract into the genesis block with the BlockApps root cert as owner
insertMercataGovernanceContract :: [ChainMemberParsedSet] -> [ChainMemberParsedSet] -> GenesisInfo -> GenesisInfo
insertMercataGovernanceContract validators admins gi =
  gi
    { genesisInfoAccountInfo = initialAccounts ++ govAcct : (validatorAccts ++ adminAccts),
      genesisInfoCodeInfo = initialCode ++ [CodeInfo governanceSrc (Just "MercataGovernance")]
    }
  where
    initialAccounts = genesisInfoAccountInfo gi
    initialCode = genesisInfoCodeInfo gi

    governanceSrc = certificateRegistryContract <> "\n\n" <> mercataGovernanceContract
    encodedGovernance = encodeUtf8 governanceSrc

    rootAddress' = fromPublicKey rootPubKey
    rootAddress = BAccount (NamedAccount rootAddress' MainChain)
    addrToCertIdx ad = BAccount (NamedAccount (fromJust . stringAddress $ ad) MainChain)
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
            (".validatorCount", BInteger . toInteger $ length validators),
            (".adminCount", BInteger . toInteger $ length admins)
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
                [ (".owner", BAccount (NamedAccount ((fromJust . stringAddress) "100") MainChain)),
                  (".org", BString $ encodeUtf8 o),
                  (".orgUnit", BString $ encodeUtf8 u),
                  (".commonName", BString $ encodeUtf8 c),
                  (".isActive", BBool True)
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
                [ (".owner", BAccount (NamedAccount ((fromJust . stringAddress) "100") MainChain)),
                  (".org", BString $ encodeUtf8 o),
                  (".orgUnit", BString $ encodeUtf8 u),
                  (".commonName", BString $ encodeUtf8 c),
                  (".isActive", BBool True)
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
