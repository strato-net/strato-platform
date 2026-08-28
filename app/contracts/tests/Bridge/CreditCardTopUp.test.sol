import "../../abstract/ERC20/access/Authorizable.sol";
import "../../concrete/Bridge/CreditCardTopUp.sol";

contract MockCreditCardToken {
    mapping(address => uint256) public balances;
    mapping(address => mapping(address => uint256)) public allowances;

    function mint(address recipient, uint256 amount) external {
        balances[recipient] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowances[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external returns (bool) {
        require(balances[sender] >= amount, "insufficient balance");
        require(allowances[sender][msg.sender] >= amount, "insufficient allowance");
        allowances[sender][msg.sender] -= amount;
        balances[sender] -= amount;
        balances[recipient] += amount;
        return true;
    }
}

contract MockExternalAssetBridge {
    address public USDST_ADDRESS;
    uint256 public nextWithdrawalId = 1;

    constructor(address usdst) {
        USDST_ADDRESS = usdst;
    }

    function routes(
        address externalToken,
        uint256 externalChainId,
        address stratoToken
    ) external view returns (IExternalRouteInfo memory) {
        return IExternalRouteInfo(
            true,
            true,
            externalChainId,
            18,
            "External USD",
            "xUSD",
            externalToken,
            stratoToken,
            0,
            0,
            true
        );
    }

    function requestWithdrawal(
        uint256,
        address,
        address,
        address stratoToken,
        uint256 stratoTokenAmount
    ) external returns (uint256) {
        MockCreditCardToken(stratoToken).transferFrom(
            msg.sender,
            address(this),
            stratoTokenAmount
        );
        return nextWithdrawalId++;
    }

    function abortWithdrawal(uint256) external {}
}

contract Describe_CreditCardTopUp is Authorizable {
    function it_routes_top_ups_through_external_asset_bridge() {
        MockCreditCardToken token = new MockCreditCardToken();
        MockExternalAssetBridge bridge = new MockExternalAssetBridge(
            address(token)
        );
        CreditCardTopUp topUp = new CreditCardTopUp(address(this));
        topUp.setExternalAssetBridge(address(bridge));

        token.mint(address(this), 10e18);
        token.approve(address(topUp), 10e18);

        uint256 withdrawalId = topUp.topUpCard(
            address(this),
            10e18,
            1,
            address(0x1234),
            address(0x5678)
        );

        require(withdrawalId == 1, "Unexpected withdrawal id");
        require(
            token.balances(address(bridge)) == 10e18,
            "Bridge did not receive top-up"
        );
    }
}
