import "../../abstract/ERC20/ERC20.sol";
import "../Tokens/Token.sol";

struct RewardBalance {
    uint balance;
    uint creationTimestamp;
    uint timestamp;
}

struct InitialRewardFactor {
    address rewardToken;
    address eligibleToken;
    uint factor;
}

struct InitialRewardBalance {
    address token;
    address user;
    RewardBalance rewardBalance;
}

struct RewardsManagerArgs {
    address[] initialRewardTokens;
    address[] initialEligibleTokens;
    InitialRewardFactor[] initialRewardFactors;
    InitialRewardBalance[] initialBalances;
    address initialRewardDelegate;
}

struct TokenRewardBalance {
    address rewardToken;
    uint rewardBalance;
}

contract record RewardsManager is Ownable {

    Token[] public record rewardTokens;
    mapping (address => uint) public record rewardTokenMap;

    Token[] public record eligibleTokens;
    mapping (address => uint) public record eligibleTokenMap;

    mapping (address => mapping (address => uint)) rewardFactors;

    mapping (address => mapping (address => RewardBalance)) rewardBalances;

    address public rewardDelegate;
    
    constructor(
        RewardsManagerArgs _args,
        address _rewardsCreator
    ) Ownable(_rewardsCreator) {
        _ownershipGranted = true;
        for (uint i = 0; i < _args.initialRewardTokens.length; i++) {
            addRewardToken(address(_args.initialRewardTokens[i]));
        }
        for (uint j = 0; j < _args.initialEligibleTokens.length; j++) {
            addEligibleToken(address(_args.initialEligibleTokens[j]));
        }

        for (uint k = 0; k < _args.initialRewardFactors.length; k++) {
            setRewardFactor(address(_args.initialRewardFactors[k].rewardToken), address(_args.initialRewardFactors[k].eligibleToken),  _args.initialRewardFactors[k].factor);
        }

        for (uint l = 0; l < _args.initialBalances.length; l++) {
            rewardBalances[address(_args.initialBalances[l].token)][address(_args.initialBalances[l].user)] = _args.initialBalances[l].rewardBalance;
        }

        setRewardDelegate(address(_args.initialRewardDelegate));
        _ownershipGranted = false;
    }

    function addRewardToken(address _token) public onlyOwnerExternal {
        require(rewardTokenMap[_token] == 0, "Token " + string(_token) + " is already registered as a reward token");
        rewardTokens.push(Token(_token));
        rewardTokenMap[_token] = rewardTokens.length;
    }

    function addRewardTokens(address[] _tokens) public onlyOwnerExternal {
        for (uint i = 0; i < _tokens.length; i++) {
            addRewardToken(_tokens[i]);
        }
    }

    function removeRewardToken(address _token) public onlyOwnerExternal {
        uint index = rewardTokenMap[_token];
        require(index != 0, "Token " + string(_token) + " is not registered as a reward token");
        Token lastRewardToken = rewardTokens[rewardTokens.length - 1];
        rewardTokens[index - 1] = lastRewardToken;
        rewardTokenMap[address(lastRewardToken)] = index;
        rewardTokenMap[_token] = 0;
        rewardTokens[rewardTokens.length - 1] = Token(address(0));
        rewardTokens.length -= 1;
    }

    function removeRewardTokens(address[] _tokens) public onlyOwnerExternal {
        for (uint i = 0; i < _tokens.length; i++) {
            removeRewardToken(_tokens[i]);
        }
    }

    function addEligibleToken(address _token) public onlyOwnerExternal {
        require(eligibleTokenMap[_token] == 0, "Token " + string(_token) + " is already registered as a token eligible to receive rewards");
        eligibleTokens.push(Token(_token));
        eligibleTokenMap[_token] = eligibleTokens.length;
        rewardBalances[_token][_token].creationTimestamp = block.timestamp;
        rewardBalances[_token][_token].timestamp = block.timestamp;
    }

    function addEligibleTokens(address[] _tokens) public onlyOwnerExternal {
        for (uint i = 0; i < _tokens.length; i++) {
            addEligibleToken(_tokens[i]);
        }
    }

    function removeEligibleToken(address _token) public onlyOwnerExternal {
        uint index = eligibleTokenMap[_token];
        require(index != 0, "Token " + string(_token) + " is not registered as a Eligible token");
        Token lastEligibleToken = eligibleTokens[eligibleTokens.length - 1];
        eligibleTokens[index - 1] = lastEligibleToken;
        eligibleTokenMap[address(lastEligibleToken)] = index;
        eligibleTokenMap[_token] = 0;
        eligibleTokens[eligibleTokens.length - 1] = Token(address(0));
        eligibleTokens.length -= 1;
    }

    function removeEligibleTokens(address[] _tokens) public onlyOwnerExternal {
        for (uint i = 0; i < _tokens.length; i++) {
            removeEligibleToken(_tokens[i]);
        }
    }

    function setRewardFactor(address _rewardToken, address _eligibleToken, uint _factor) public onlyOwnerExternal {
        rewardFactors[_rewardToken][_eligibleToken] = _factor;
    }

    function setRewardFactors(InitialRewardFactor[] _rewardFactors) onlyOwnerExternal {
        for (uint i = 0; i < _rewardFactors.length; i++) {
            setRewardFactor(address(_rewardFactors[i].rewardToken), address(_rewardFactors[i].eligibleToken), _rewardFactors[i].factor);
        }
    }

    function setRewardDelegate(address _rewardDelegate) public onlyOwnerExternal {
        rewardDelegate = _rewardDelegate;
    }

    function _calculateRewardBalanceForToken(address _token, address _user, bool _claim) internal returns (TokenRewardBalance[]) {
        TokenRewardBalance[] claimableRewardBalances;

        uint _accountTimestamp = rewardBalances[_token][_user].timestamp;
        if (_accountTimestamp == 0) {
            _accountTimestamp = rewardBalances[_token][_token].creationTimestamp;
            rewardBalances[_token][_user].creationTimestamp = block.timestamp;
        }

        // Update user's accrued rewards
        uint _accountDelta = block.timestamp - _accountTimestamp;
        rewardBalances[_token][_user].balance += ERC20(_token).balanceOf(_user) * _accountDelta;
        rewardBalances[_token][_user].timestamp = block.timestamp;

        // Update token's accrued rewards
        uint delta = block.timestamp - rewardBalances[_token][_token].timestamp;
        rewardBalances[_token][_token].balance += ERC20(_token).totalSupply() * delta;
        rewardBalances[_token][_token].timestamp = block.timestamp;

        uint userClaimableReward = rewardBalances[_token][_user].balance;

        if (_claim) {
            rewardBalances[_token][_token].balance -= userClaimableReward;
            rewardBalances[_token][_user].balance = 0;
        }

        for (uint j = 0; j < rewardTokens.length; j++) {
            // uint contractRewardBalance = ERC20(rewardTokens[j]).balanceOf(_token);
            uint rewardFactor = rewardFactors[address(rewardTokens[j])][_token];
            if (rewardFactor == 0) {
                uint rewardFactorDen = 10 * 60 * 60 * 24 * 365; // 10% APY
                rewardFactor = 1e18 / rewardFactorDen;
            }
            uint rewardNum = userClaimableReward; // * contractRewardBalance;
            uint rewardValue = rewardNum / rewardFactor; // rewardBalances[_token][_token].balance;
            claimableRewardBalances.push(TokenRewardBalance(_token, rewardValue));
        }

        return claimableRewardBalances;
    }

    function _rewardBalanceOf(address _user, bool _claim) internal returns (TokenRewardBalance[]) {
        TokenRewardBalance[] claimableRewardBalances;
        for (uint j = 0; j < rewardTokens.length; j++) {
            claimableRewardBalances.push(TokenRewardBalance(address(rewardTokens[j]), 0));
        }
        for (uint i = 0; i < eligibleTokens.length; i++) {
            address _token = address(eligibleTokens[i]);
            TokenRewardBalance[] claimableForToken;
            if (rewardDelegate != address(0)) {
                claimableForToken = rewardDelegate.delegatecall("calculateRewardBalanceForToken", _token, _user, _claim);
            } else {
                claimableForToken = _calculateRewardBalanceForToken(_token, _user, _claim);
            }
            for (uint k = 0; k < rewardTokens.length; k++) {
                claimableRewardBalances[k].rewardBalance += claimableForToken[k].rewardBalance;
            }
        }
        return claimableRewardBalances;
    }

    function rewardBalanceOf(address _user) public view returns (TokenRewardBalance[]) {
        return _rewardBalanceOf(_user, false);
    }

    function updateRewardsBalanceFor(address _token, address _user) public {
        if (rewardDelegate != address(0)) {
            rewardDelegate.delegatecall("calculateRewardBalanceForToken", _token, _user, false);
        } else {
            _calculateRewardBalanceForToken(_token, _user, false);
        }
    }

    function claimRewardsFor(address _user) public {
        TokenRewardBalance[] claimableRewards = _rewardBalanceOf(_user, true);
        for (uint i = 0; i < claimableRewards.length; i++) {
            Token(claimableRewards[i].rewardToken).mint(_user, claimableRewards[i].rewardBalance);
        }
    }
}