import "../../abstract/ERC20/IERC20.sol";
import "./CalendarMonths.sol";

// Shared lifecycle for the tokenomics schedules.
//
// Setup phase: the setup admin configures the schedule (TGE, grants, amounts) while
// the allocation is minted in. finalize() checks the funding and drops the setup
// admin for good. From then on no key can change anything; releases are
// permissionless and always pay the schedule's own beneficiaries.
//
// The setup admin is an explicit address rather than msg.sender: a contract created
// through an AdminRegistry vote would otherwise be set up by the registry, whose
// execution path needs a fresh vote for every setup call.
abstract contract TokenomicsSchedule is CalendarMonths {
    string public category;
    address public token;
    uint public tgeTimestamp;
    address public setupAdmin;
    bool public finalized;

    event TgeTimestampSet(uint tgeTimestamp);
    event Finalized(uint required);

    constructor(string _category, address _token, uint _tgeTimestamp, address _setupAdmin) {
        require(_token != address(0), "TokenomicsSchedule: token is zero");
        require(_setupAdmin != address(0), "TokenomicsSchedule: setup admin is zero");
        category = _category;
        token = _token;
        tgeTimestamp = _tgeTimestamp;
        setupAdmin = _setupAdmin;
    }

    modifier onlySetup() {
        require(msg.sender == setupAdmin, "TokenomicsSchedule: caller is not setup admin");
        _;
    }

    // The amount the schedule must hold to finalize.
    function _required() internal view virtual returns (uint);

    function setTgeTimestamp(uint _tgeTimestamp) external onlySetup {
        tgeTimestamp = _tgeTimestamp;
        emit TgeTimestampSet(_tgeTimestamp);
    }

    // Anything sent beyond the required amount is never releasable, so a stray
    // transfer cannot block finalization.
    function finalize() external onlySetup {
        uint required = _required();
        require(required > 0, "TokenomicsSchedule: nothing to vest");
        require(IERC20(token).balanceOf(address(this)) >= required, "TokenomicsSchedule: underfunded");
        finalized = true;
        setupAdmin = address(0);
        emit Finalized(required);
    }

    function monthsSinceTge() external view returns (uint) {
        return _monthsBetween(tgeTimestamp, block.timestamp);
    }

    modifier onlyFinalized() {
        require(finalized, "TokenomicsSchedule: not finalized");
        _;
    }

    function _pay(address to, uint amount) internal {
        require(IERC20(token).transfer(to, amount), "TokenomicsSchedule: transfer failed");
    }
}
