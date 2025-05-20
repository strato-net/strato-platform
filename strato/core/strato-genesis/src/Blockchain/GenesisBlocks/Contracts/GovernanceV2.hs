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
import Blockchain.Strato.Model.CodePtr
import qualified Blockchain.Strato.Model.Keccak256 as KECCAK256
import Blockchain.Strato.Model.Validator
import Data.Text (Text)
import Data.Text.Encoding
import SolidVM.Model.Storable hiding (size)
import Text.RawString.QQ

-- | Inserts a Governance contract into the genesis block with the BlockApps root cert as owner
insertMercataGovernanceContract :: [Validator] -> [Text] -> GenesisInfo -> GenesisInfo
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
    rootAddress = BAccount (NamedAccount rootAddress' UnspecifiedChain)
    addrToCertIdx ad = BAccount (NamedAccount ad UnspecifiedChain)
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
                (i, Validator c) ->
                  ( encodeUtf8 $ ".validatorMap<\"" <> c <> "\">",
                    addrToCertIdx $ validatorAddr i
                  )
            )
            valIx
          ++ map
            ( \case
                (i, c) ->
                  ( encodeUtf8 $ ".adminMap<\"" <> c <> "\">",
                    addrToCertIdx $ adminAddr i
                  )
            )
            adminIx
    validatorAccts =
      map
        ( \case
            (i, Validator validator) ->
              SolidVMContractWithStorage
                (validatorAddr i)
                0
                (SolidVMCode "MercataValidator" (KECCAK256.hash encodedGovernance))
                [ (".owner", BAccount (NamedAccount 100 UnspecifiedChain)),
                  (".commonName", BString $ encodeUtf8 validator),
                  (".isActive", BBool True)
                ]
        )
        valIx
    adminAccts =
      map
        ( \case
            (i, admin) ->
              SolidVMContractWithStorage
                (adminAddr i)
                0
                (SolidVMCode "MercataAdmin" (KECCAK256.hash encodedGovernance))
                [ (".owner", BAccount (NamedAccount 100 UnspecifiedChain)),
                  (".commonName", BString $ encodeUtf8 admin),
                  (".isActive", BBool True)
                ]
        )
        adminIx

mercataGovernanceContract :: Text
mercataGovernanceContract =
  [r|
contract record MercataValidator {
    address public owner;

    string public commonName;

    bool public isActive;

    uint public votedInTime;
    uint public votedOutTime;

    constructor(string _commonName) {
        owner = msg.sender;
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

contract record MercataAdmin {
    address public owner;

    string public commonName;

    bool public isActive;

    uint public votedInTime;
    uint public votedOutTime;

    constructor(string _commonName) {
        owner = msg.sender;
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

contract record MercataValidatorVote {

    address public owner;

    string public recipientCommonName;

    string public voterCommonName;

    bool public voteDirection;

    bool public isActive;
    bool public isFinal;

    uint public voteTimestamp;
    uint public deactivationTimestamp;
    uint public finalizationTimestamp;

    constructor(string _voterCommonName,
                string _recipientCommonName,
                bool _voteDirection) {
        owner = msg.sender;
        voterCommonName = _voterCommonName;
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

contract record MercataAdminVote {

    address public owner;

    string public recipientCommonName;

    string public voterCommonName;

    bool public voteDirection;

    bool public isActive;
    bool public isFinal;

    uint public voteTimestamp;
    uint public deactivationTimestamp;
    uint public finalizationTimestamp;

    constructor(string _voterCommonName,
                string _recipientCommonName,
                bool _voteDirection) {
        owner = msg.sender;
        voterCommonName = _voterCommonName;
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

contract record MercataGovernance {
    mapping (string => MercataValidator) public record validatorMap;
    uint validatorCount;

    mapping (string => MercataAdmin) public record adminMap;
    uint adminCount;

    mapping (string => mapping (string => uint)) public record validatorVoteMap;
    mapping (string => MercataValidatorVote[]) public record validatorVotes;
    mapping (string => uint) public record validatorVoteCountMap;

    mapping (string => mapping (string => uint)) public record adminVoteMap;
    mapping (string => MercataAdminVote[]) public record adminVotes;
    mapping (string => uint) public record adminVoteCountMap;

    address public owner;

    event ValidatorAdded(string commonName);
    event ValidatorRemoved(string commonName);
    
    function voteToAddValidator(string _commonName) {
        Certificate c = CertificateRegistry(address(0x509)).getUserCert(tx.origin);
        require(address(c) != address(0), "Voting to add a validator requires having a valid X.509 certificate");
        require(c.isValid(), "Voting to add a validator requires having a valid X.509 certificate");
        string originName = c.commonName();

        MercataAdmin a = adminMap[originName];
        require(address(a) != address(0), "Only registered network admins can vote for validators");
        require(a.isActive(), "Only registered network admins can vote for validators");
        
        MercataValidator v = validatorMap[_commonName];
        require(address(v) == address(0), "Votes to add cannot be counted for current validators");
        
        uint voteIndex = validatorVoteMap[_commonName][originName];
        require(voteIndex == 0, "Vote to add already cast for " + _commonName);
        MercataValidatorVote newVote = new MercataValidatorVote(originName, _commonName, true);
        uint voteCount = validatorVoteCountMap[_commonName] + 1;
        validatorVoteCountMap[_commonName] = voteCount;
        validatorVotes[_commonName].push(newVote);
        validatorVoteMap[_commonName][originName] = validatorVotes[_commonName].length;

        uint newVoteCount = validatorVoteCountMap[_commonName];
        if (newVoteCount >= ((2 * adminCount) / 3) + 1) {
            MercataValidatorVote[] votes = validatorVotes[_commonName];
            for (uint i = 0; i < votes.length; i++) {
                votes[i].finalize();
                string voteName = votes[i].voterCommonName();
                validatorVoteMap[_commonName][voteName] = 0;
                votes[i] = MercataValidatorVote(address(0));
            }
            validatorVotes[_commonName].length = 0;
            validatorVoteCountMap[_commonName] = 0;
            MercataValidator newValidator = new MercataValidator(_commonName);
            validatorMap[_commonName] = newValidator;
            validatorCount++;
            emit ValidatorAdded(_commonName);
        }
    }
    
    function voteToRemoveValidator(string _commonName) {
        Certificate c = CertificateRegistry(address(0x509)).getUserCert(tx.origin);
        require(address(c) != address(0), "Voting to add a validator requires having a valid X.509 certificate");
        require(c.isValid(), "Voting to add a validator requires having a valid X.509 certificate");
        string originName = c.commonName();

        MercataAdmin a = adminMap[originName];
        require(address(a) != address(0), "Only registered network admins can vote for validators");
        require(a.isActive(), "Only registered network admins can vote for validators");
        
        MercataValidator v = validatorMap[_commonName];
        require(address(v) != address(0), "Votes to remove can only be counted for current validators");
        
        uint voteIndex = validatorVoteMap[_commonName][originName];
        require(voteIndex == 0, "Vote to add already cast for " + _commonName);
        MercataValidatorVote newVote = new MercataValidatorVote(originName, _commonName, false);
        uint voteCount = validatorVoteCountMap[_commonName] + 1;
        validatorVoteCountMap[_commonName] = voteCount;
        validatorVotes[_commonName].push(newVote);
        validatorVoteMap[_commonName][originName] = validatorVotes[_commonName].length;

        uint newVoteCount = validatorVoteCountMap[_commonName];
        if (newVoteCount >= ((2 * adminCount) / 3) + 1) {
            MercataValidatorVote[] votes = validatorVotes[_commonName];
            for (uint i = 0; i < votes.length; i++) {
                votes[i].finalize();
                string voteName = votes[i].voterCommonName();
                validatorVoteMap[_commonName][voteName] = 0;
                votes[i] = MercataValidatorVote(address(0));
            }
            validatorVotes[_commonName].length = 0;
            validatorVoteCountMap[_commonName] = 0;
            v.deactivate();
            validatorMap[_commonName] = MercataValidator(address(0));
            validatorCount--;
            emit ValidatorRemoved(_commonName);
        }
    }
    
    function voteToAddAdmin(string _commonName) {
        Certificate c = CertificateRegistry(address(0x509)).getUserCert(tx.origin);
        require(address(c) != address(0), "Voting to add a network admin requires having a valid X.509 certificate");
        require(c.isValid(), "Voting to add an admin requires having a valid X.509 certificate");
        string originName = c.commonName();

        MercataAdmin a = adminMap[originName];
        require(address(a) != address(0), "Only registered network admins can vote for admins");
        require(a.isActive(), "Only registered network admins can vote for admins");
        
        MercataAdmin v = adminMap[_commonName];
        require(address(v) == address(0), "Votes to add cannot be counted for current admins");
        
        uint voteIndex = adminVoteMap[_commonName][originName];
        require(voteIndex == 0, "Vote to add already cast for " + _commonName);
        MercataAdminVote newVote = new MercataAdminVote(originName, _commonName, true);
        uint voteCount = adminVoteCountMap[_commonName] + 1;
        adminVoteCountMap[_commonName] = voteCount;
        adminVotes[_commonName].push(newVote);
        adminVoteMap[_commonName][originName] = adminVotes[_commonName].length;

        uint newVoteCount = adminVoteCountMap[_commonName];
        if (newVoteCount >= ((2 * adminCount) / 3) + 1) {
            MercataAdminVote[] votes = adminVotes[_commonName];
            for (uint i = 0; i < votes.length; i++) {
                votes[i].finalize();
                string voteName = votes[i].voterCommonName();
                adminVoteMap[_commonName][voteName] = 0;
                votes[i] = MercataAdminVote(address(0));
            }
            adminVotes[_commonName].length = 0;
            adminVoteCountMap[_commonName] = 0;
            MercataAdmin newAdmin = new MercataAdmin(_commonName);
            adminMap[_commonName] = newAdmin;
            adminCount++;
        }
    }
    
    function voteToRemoveAdmin(string _commonName) {
        Certificate c = CertificateRegistry(address(0x509)).getUserCert(tx.origin);
        require(address(c) != address(0), "Voting to add an admin requires having a valid X.509 certificate");
        require(c.isValid(), "Voting to add an admin requires having a valid X.509 certificate");
        string originName = c.commonName();

        MercataAdmin a = adminMap[originName];
        require(address(a) != address(0), "Only registered network admins can vote for admins");
        require(a.isActive(), "Only registered network admins can vote for admins");
        
        MercataAdmin v = adminMap[_commonName];
        require(address(v) != address(0), "Votes to remove can only be counted for current admins");
        
        uint voteIndex = adminVoteMap[_commonName][originName];
        require(voteIndex == 0, "Vote to add already cast for " + _commonName);
        MercataAdminVote newVote = new MercataAdminVote(originName, _commonName, false);
        uint voteCount = adminVoteCountMap[_commonName] + 1;
        adminVoteCountMap[_commonName] = voteCount;
        adminVotes[_commonName].push(newVote);
        adminVoteMap[_commonName][originName] = adminVotes[_commonName].length;

        uint newVoteCount = adminVoteCountMap[_commonName];
        if (newVoteCount >= ((2 * adminCount) / 3) + 1) {
            MercataAdminVote[] votes = adminVotes[_commonName];
            for (uint i = 0; i < votes.length; i++) {
                votes[i].finalize();
                string voteName = votes[i].voterCommonName();
                adminVoteMap[_commonName][voteName] = 0;
                votes[i] = MercataAdminVote(address(0));
            }
            adminVotes[_commonName].length = 0;
            adminVoteCountMap[_commonName] = 0;
            v.deactivate();
            adminMap[_commonName] = MercataAdmin(address(0));
            adminCount--;
        }
    }
}|]
