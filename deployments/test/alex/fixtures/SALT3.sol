contract BlockchainRTGSv3 {

    address public centralBank;
    bool public operational;
    uint public confirmationSeconds;
    uint public totalTransactions;



    struct SharedSymKeys {
        string encryptedTransactionSharedSymKey;
        string encryptedCentralBankTransactionSharedSymKey;
    }

    struct Bank {
        bool exists;
        bool allowed;
        int relativeBalance;
        string name;
        string encryptedBalanceForBank;
        string encryptedBalanceForCentralBank;
        string certificate;
        mapping (address => SharedSymKeys) encryptedSharedSymKeys;
    }


    struct BankWeb{
        address addrBank;
        string name;
    }

    struct Transaction {
        uint time;
        address senderBank;
        address rcptBank;
        address msgSender;
        string transactionEncryptedData;
        bool confirmed;
        bool allowed;
    }


    mapping (address => Bank) public banks;
    mapping (uint => Transaction) public transactionLog;
    mapping(address => uint[]) public bankTransactions;


    BankWeb[] public banksWeb;


    function BlockchainRTGSv3(){

        centralBank=msg.sender;
        operational=false;
        totalTransactions = 0;
        confirmationSeconds = 600;
    }

    modifier onlyOwner() { if (msg.sender != centralBank) throw;_
    }

    modifier onlyIfAllowed() { if (!banks[msg.sender].allowed) throw;_
    }

    function makeOperational() onlyOwner {
        operational=true;
    }

    function changeConfirmationSeconds(uint _confirmationSeconds) onlyOwner {
        confirmationSeconds=_confirmationSeconds;
    }

    function addBank (address _bank, string _name, string _certificate) onlyOwner returns (uint) {

        banks[_bank].exists=true;
        banks[_bank].allowed = true;
        banks[_bank].name = _name;
        banks[_bank].certificate = _certificate;
        banksWeb.push(BankWeb(_bank,_name));
        return banksWeb.length;

    }

    function set(uint x) {

    }

    function addSharedSymmetricKeys(address _senderBank, address _rcptBank, string _encryptedSenderTrSymKey, string _encryptedRcptTrSymKey, string _encryptedCentralBankTrSymKey) onlyOwner {
        banks[_senderBank].encryptedSharedSymKeys[_rcptBank].encryptedTransactionSharedSymKey = _encryptedSenderTrSymKey;
        banks[_rcptBank].encryptedSharedSymKeys[_senderBank].encryptedTransactionSharedSymKey = _encryptedRcptTrSymKey;
        banks[_senderBank].encryptedSharedSymKeys[_rcptBank].encryptedCentralBankTransactionSharedSymKey = _encryptedCentralBankTrSymKey;
        banks[_rcptBank].encryptedSharedSymKeys[_senderBank].encryptedCentralBankTransactionSharedSymKey = _encryptedCentralBankTrSymKey;
    }

    function updateBalance(address _bank, string _encryptedBalanceForCentralBank,
    string _encryptedBalanceForBank) onlyOwner {
        banks[_bank].encryptedBalanceForCentralBank = _encryptedBalanceForCentralBank;
        banks[_bank].encryptedBalanceForBank = _encryptedBalanceForBank;
    }

    function createTransaction(address _rcptBank, string _transactionEncryptedData) onlyIfAllowed {

        if (!banks[_rcptBank].exists) throw;
        if (!banks[msg.sender].exists) throw;
        if (!operational) throw;

        totalTransactions++;
        bankTransactions[msg.sender].push(totalTransactions);
        bankTransactions[_rcptBank].push(totalTransactions);


        transactionLog[totalTransactions] = Transaction(now,msg.sender,_rcptBank,msg.sender,_transactionEncryptedData,false,true);
    }

       function createCentralBankTransaction(address _senderBank, address _rcptBank, string _transactionEncryptedData) onlyOwner {

        if (!banks[_rcptBank].exists) throw;
        if (!banks[_senderBank].exists) throw;
        if (!operational) throw;

        totalTransactions++;
        bankTransactions[_senderBank].push(totalTransactions);
        bankTransactions[_rcptBank].push(totalTransactions);

        transactionLog[totalTransactions] = Transaction(now,_senderBank,_rcptBank,msg.sender,_transactionEncryptedData,false,true);
    }


    function confirmTransaction(uint _transaction) onlyIfAllowed {
        if ((msg.sender != transactionLog[_transaction].senderBank) &&
            (msg.sender != centralBank)) throw;
        if (!transactionLog[_transaction].allowed) throw;

        if (now-transactionLog[_transaction].time < confirmationSeconds) throw;

        /*banks[transactionLog[_transaction].senderBank].relativeBalance -= transactionLog[_transaction].value;
        banks[transactionLog[_transaction].rcptBank].relativeBalance += transactionLog[_transaction].value;*/
        transactionLog[_transaction].confirmed=true;
    }

    function blockBank(address _bankToBlk) onlyOwner {
        banks[_bankToBlk].allowed = false;
    }

    function unblockBank(address _bankToBlk) onlyOwner {
        banks[_bankToBlk].allowed = true;
    }

    function blockTransaction(uint _transaction) onlyOwner {
        transactionLog[_transaction].allowed = false;
    }

    function unblockTransaction(uint _transaction) onlyOwner {
        transactionLog[_transaction].allowed = true;
    }



    function kill() onlyOwner {
        suicide(centralBank);
    }
}
