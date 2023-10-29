import "/dapp/payments/contracts/Payment.sol";
import "/dapp/addresses/contracts/UserAddress.sol";
import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/payments/contracts/PaymentProvider.sol";
import "/dapp/payments/contracts/PaymentServices.sol";

contract Mem_PaymentManager is PaymentServices {

    constructor(){}

    function createPayment(string _paymentSessionId, string _paymentProvider, string _paymentStatus, string _sessionStatus, string _amount, uint _expiresAt, uint _createdDate, string _sellerAccountId) public returns(uint,address){
        Mem_Payment_3 payment = new Mem_Payment_3(_paymentSessionId, _paymentProvider, _paymentStatus, _sessionStatus, _amount, _expiresAt, _createdDate, _sellerAccountId);
        return (RestStatus.CREATED, address(payment));
    }
  

    function updatePayment(address _payment, string _paymentStatus, string _sessionStatus, string _paymentIntentId, uint _scheme)public returns(uint,address){
        Mem_Payment_3 payment = Mem_Payment_3(_payment);
        payment.update(_paymentStatus, _sessionStatus, _paymentIntentId,_scheme);
        return (RestStatus.OK, address(payment));
    }

    function createUserAddress(string _shippingName, string _shippingZipcode, string _shippingState, string _shippingCity, string _shippingAddressLine1, string _shippingAddressLine2, string _billingName, string _billingZipcode, string _billingState, string _billingCity, string _billingAddressLine1, string _billingAddressLine2, uint _createdDate) public returns(uint,address){
        Mem_UserAddress_1 userAddress = new Mem_UserAddress_1(_shippingName,_shippingZipcode,_shippingState,_shippingCity,_shippingAddressLine1,_shippingAddressLine2,_billingName,_billingZipcode,_billingState,_billingCity,_billingAddressLine1,_billingAddressLine2,_createdDate);
        return (RestStatus.CREATED, address(userAddress));
    }

    function createPaymentProvider(PaymentServices _name, string _accountId, uint _createdDate) public returns(uint,address){
        Mem_PaymentProvider_1 paymentProvider = new Mem_PaymentProvider_1(_name, _accountId,_createdDate);
        return (RestStatus.CREATED, address(paymentProvider));
    }

    function updatePaymentProvider(address _paymentProviderAddress, bool _chargesEnabled, bool _detailsSubmitted, bool _payoutsEnabled, uint _eventTime, bool _accountDeauthorized, uint _scheme)public returns(uint,address){
        Mem_PaymentProvider_1 paymentProvider = Mem_PaymentProvider_1(_paymentProviderAddress);
        paymentProvider.update(_chargesEnabled, _detailsSubmitted, _payoutsEnabled, _eventTime, _accountDeauthorized, _scheme);
        return (RestStatus.OK, address(paymentProvider));
    }

}