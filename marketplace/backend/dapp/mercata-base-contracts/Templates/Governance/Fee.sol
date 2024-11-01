// pragma solidvm12.0;

// import <509>;

// contract MercataProposerFee is MercataGovernance {

//     address mercataGovernance = "";
//     uint private proposerFee;
//     mapping (string => mapping (string => mapping (string => bool))) public hasVoted;  // Track if a validator has already voted
//     uint public totalVotes;
//     uint public proposerFeeFinalizationThreshold;
//     address public owner;

//     event ProposerFeeUpdated(uint newFee);

//     constructor(uint _initialFee, uint _threshold) {
//         proposerFee = _initialFee;
//         owner = MercataGovernance(mercataGovernance).owner();
//         proposerFeeFinalizationThreshold = _threshold;
//         initializeHasVoted();  // Initialize hasVoted for all current validators
//     }

//     // Initializes the `hasVoted` mapping for all current validators
//     function initializeHasVoted() internal {
//         // Loop through the validatorMap in MercataGovernance and set hasVoted to false for each
//         // You will need to implement a way to loop over the validatorMap keys if not already available
//         for (uint i = 0; i < validatorCount; i++) {
//             (string memory org, string memory unit, string memory name) = getValidatorDetails(i);  // Example function, implement as needed
//             if (validatorMap[org][unit][name].isActive()) {
//                 hasVoted[org][unit][name] = false;
//             }
//         }
//     }

//     // Updates the validator list whenever a vote is called to ensure new validators are accounted for
//     function updateValidators() internal {
//         // Add any new validators who may not have been in the original hasVoted map
//         for (uint i = 0; i < validatorCount; i++) {
//             (string memory org, string memory unit, string memory name) = getValidatorDetails(i);  // Example function
//             if (validatorMap[org][unit][name].isActive() && hasVoted[org][unit][name] == false) {
//                 hasVoted[org][unit][name] = false;
//             }
//         }

//         // Handle removing any inactive validators from the hasVoted map
//         for (uint i = 0; i < validatorCount; i++) {
//             (string memory org, string memory unit, string memory name) = getValidatorDetails(i);  // Example function
//             if (!validatorMap[org][unit][name].isActive()) {
//                 hasVoted[org][unit][name] = false;  // Invalidate their voting status
//             }
//         }
//     }

//     function voteToSetProposerFee(string memory _org, string memory _orgUnit, string memory _commonName, uint _newFee) public {
//         // Refresh validator list before voting
//         updateValidators();

//         // Ensure only active validators can vote
//         MercataValidator v = validatorMap[_org][_orgUnit][_commonName];
//         require(address(v) != address(0), "Only registered validators can vote for proposer fee");
//         require(v.isActive(), "Only active validators can vote for proposer fee");

//         // Check if the validator has already voted
//         require(!hasVoted[_org][_orgUnit][_commonName], "Validator has already voted");

//         // Mark the validator as having voted
//         hasVoted[_org][_orgUnit][_commonName] = true;

//         // Increment the total number of votes
//         totalVotes++;

//         // Check if the vote count has reached the finalization threshold
//         if (totalVotes >= proposerFeeFinalizationThreshold) {
//             finalizeProposerFee(_newFee);
//         }
//     }

//     function finalizeProposerFee(uint _newFee) internal {
//         proposerFee = _newFee;
//         resetVotes();  // Reset voting state for the next round
//         emit ProposerFeeUpdated(_newFee);
//     }

//     function resetVotes() internal {
//         // Reset all votes by marking hasVoted as false for all active validators
//         for (uint i = 0; i < validatorCount; i++) {
//             (string memory org, string memory unit, string memory name) = getValidatorDetails(i);  // Example function
//             if (validatorMap[org][unit][name].isActive()) {
//                 hasVoted[org][unit][name] = false;
//             }
//         }
//         totalVotes = 0;
//     }
// }

pragma solidvm 12.0;

contract MercataProposerFee {
    uint proposerFee;

    constructor(){
        proposerFee=5;
    }

    function getProposerFee() public returns (uint){
        return proposerFee;
    }
}