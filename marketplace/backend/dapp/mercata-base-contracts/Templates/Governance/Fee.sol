pragma "solidvm12.0";

import <509>;

contract MercataProposerFee {

    uint private proposerFee;
    mapping (string => mapping (string => mapping (string => uint))) proposerFeeVoteMap;
    mapping (string => mapping (string => mapping (string => MercataValidatorVote[]))) proposerFeeVotes;
    mapping (string => mapping (string => mapping (string => uint))) proposerFeeVoteCountMap;
    
    uint public proposerFeeFinalizationThreshold;
    address public owner;

    event ProposerFeeUpdated(uint newFee);

    constructor(uint _initialFee, uint _threshold) {
        proposerFee = _initialFee;
        owner = address("0x509");
        proposerFeeFinalizationThreshold = _threshold;
    }

    function getProposerFee() public view returns (uint) {
        return proposerFee;
    }

    function voteToSetProposerFee(uint _newFee) public {
        Certificate c = CertificateRegistry(address(0x509)).getUserCert(tx.origin);
        require(address(c) != address(0), "Voting to set proposer fee requires having a valid X.509 certificate");
        require(c.isValid(), "Voting to set proposer fee requires having a valid X.509 certificate");
        string memory originOrg = c.organization();
        string memory originUnit = c.organizationalUnit();
        string memory originName = c.commonName();

        MercataValidator v = MercataGovernance(address(0x509)).validatorMap(originOrg, originUnit, originName);
        require(address(v) != address(0), "Only validators can vote for proposer fee");
        require(v.isActive(), "Only active validators can vote for proposer fee");

        // Check if the validator already voted
        uint voteIndex = proposerFeeVoteMap[originOrg][originUnit][originName];
        require(voteIndex == 0, "Validator has already voted");

        // Create a new vote
        MercataValidatorVote newVote = new MercataValidatorVote(originOrg, originUnit, originName, "", "", "", true);
        uint voteCount = proposerFeeVoteCountMap[originOrg][originUnit][originName] + 1;
        proposerFeeVoteCountMap[originOrg][originUnit][originName] = voteCount;
        proposerFeeVotes[originOrg][originUnit][originName].push(newVote);
        proposerFeeVoteMap[originOrg][originUnit][originName] = proposerFeeVotes[originOrg][originUnit][originName].length;

        // If enough votes, finalize the new proposer fee
        uint newVoteCount = proposerFeeVoteCountMap[originOrg][originUnit][originName];
        if (newVoteCount >= proposerFeeFinalizationThreshold) {
            finalizeProposerFee(_newFee);
        }
    }

    function finalizeProposerFee(uint _newFee) internal {
        proposerFee = _newFee;

        // Reset votes
        for (uint i = 0; i < proposerFeeVoteCountMap.length; i++) {
            proposerFeeVotes; // Clear all votes
        }
        proposerFeeVoteCountMap = 0;

        emit ProposerFeeUpdated(_newFee);
    }
}
