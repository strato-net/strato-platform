contract CarbonCredit is FractionalizedFungible {
    // Mapping to keep track of retired credits for each address
    mapping(address => uint) public retiredCredits;

    // The price per carbon credit (in wei)
    uint public pricePerCredit;

    constructor(
        string memory _assetID,
        uint _initialFractionalizationRatio,
        uint _totalSupply,
        string memory _name,
        uint8 _decimals,
        uint _initialPricePerCredit // Initial price per credit
    ) FractionalizedFungible(_assetID, _initialFractionalizationRatio, _totalSupply, _name, _decimals) {
        // Set the initial price per credit
        pricePerCredit = _initialPricePerCredit;
    }

    // Function for retiring carbon credits
    function retireCredits(uint amount) public payable {
        // Calculate the cost of retiring the specified amount of credits
        uint retirementCost = pricePerCredit * amount;

        // Ensure the sender has paid the required amount
        require(msg.value >= retirementCost, "Insufficient payment to retire credits");

        // Ensure the sender has enough credits to retire
        require(balanceOf[msg.sender] >= amount, "Not enough credits to retire");

        // Deduct the retired credits from the sender's balance
        balanceOf[msg.sender] -= amount;

        // Increase the retired credits for the sender
        retiredCredits[msg.sender] += amount;

        // Emit an event to log the retirement
        emit CreditsRetired(msg.sender, amount, retirementCost);

        // Refund any excess payment to the sender
        if (msg.value > retirementCost) {
            payable(msg.sender).transfer(msg.value - retirementCost);
        }
    }

    // Function for selling carbon credits to another address with a specified price
    function sellCredits(address recipient, uint amount, uint creditPrice) public {
        // Ensure the sender has enough non-retired credits to sell
        require(balanceOf(msg.sender) - retiredCredits[msg.sender] >= amount, "Not enough non-retired credits to sell");

        // Calculate the total cost for the credits to be sold
        uint totalPrice = creditPrice * amount;

        // Ensure the sender receives the correct payment
        require(msg.value >= totalPrice, "Insufficient payment for credits");

        // Perform the transfer of credits to the recipient
        transfer(recipient, amount);


        // Refund any excess payment to the sender
        if (msg.value > totalPrice) {
            payable(msg.sender).transfer(msg.value - totalPrice);
        }
    }

    // Function to set the price per credit (can only be called by the contract owner)
    function setPricePerCredit(uint _price) public onlyOwner {
        pricePerCredit = _price;
    }

    // Event to log the retirement of credits
    event CreditsRetired(address indexed account, uint amount, uint cost);
}


contract CarbonCreditFractionalBucket {
    // Mapping to store fractional units sent by each address
    mapping(address => uint) public fractionalUnits;

    // Reference to the main CarbonCredit contract
    address public carbonCreditContract;
    
    // Constructor to set the address of the main CarbonCredit contract
    constructor(address _carbonCreditContract) {
        carbonCreditContract = _carbonCreditContract;
    }

    // Function to send fractional units to the Fractional Bucket
    function sendFractionalUnits(uint amount) external {
        // Ensure that the sender is the main CarbonCredit contract
        require(msg.sender == carbonCreditContract, "Only the main CarbonCredit contract can send fractional units");
        
        // Ensure the amount is less than or equal to 1
        require(amount <= 1 ether, "Amount exceeds 1 fractional unit");
        
        // Add the fractional units to the sender's balance
        fractionalUnits[msg.sender] += amount;
        
        // If the total fractional units exceed 1, retire a carbon credit
        if (getTotalFractionalUnits() >= 1 ether) {
            retireCarbonCredit();
        }
    }

    // Function to retire a whole carbon credit
    function retireCarbonCredit() internal {
        // Calculate how many whole carbon credits can be retired
        uint wholeCredits = getTotalFractionalUnits() / 1 ether;

        // Ensure there is at least one whole credit to retire
        require(wholeCredits > 0, "No whole credits to retire");

        // Calculate the total fractional units to be used for retirement
        uint totalFractionalUnitsToUse = wholeCredits * 1 ether;

        // Reduce the fractional units of the senders accordingly
        for (uint i = 0; i < wholeCredits; i++) {
            address sender = getSenderWithFractionalUnits();
            fractionalUnits[sender] -= 1 ether;
        }

        // Call the retireCredits function in the main CarbonCredit contract
        CarbonCredit(carbonCreditContract).retireCredits(totalFractionalUnitsToUse / 1 ether);
    }

    // Function to get the total fractional units in the bucket
    function getTotalFractionalUnits() public view returns (uint) {
        return address(this).balance;
    }

    // Function to get the sender with the most fractional units
    function getSenderWithFractionalUnits() internal view returns (address) {
        address senderWithMost = address(0);
        uint mostFractionalUnits = 0;

        for (uint i = 0; i < addressCount(); i++) {
            address sender = fractionalUnitSenders[i];
            uint units = fractionalUnits[sender];
            if (units > mostFractionalUnits) {
                mostFractionalUnits = units;
                senderWithMost = sender;
            }
        }

        return senderWithMost;
    }

    // Function to get the number of addresses with fractional units
    function addressCount() internal view returns (uint) {
        uint count = 0;
        for (uint i = 0; i < fractionalUnitSenders.length; i++) {
            if (fractionalUnits[fractionalUnitSenders[i]] > 0) {
                count++;
            }
        }
        return count;
    }

    // Array to store addresses with fractional units
    address[] public fractionalUnitSenders;
    
    // Function to add a sender to the fractionalUnitSenders array
    function addSender(address sender) internal {
        for (uint i = 0; i < fractionalUnitSenders.length; i++) {
            if (fractionalUnitSenders[i] == sender) {
                return;
            }
        }
        fractionalUnitSenders.push(sender);
    }
}
