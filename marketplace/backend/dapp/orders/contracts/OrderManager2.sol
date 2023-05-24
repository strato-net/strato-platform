// import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
// import "/dapp/orders/contracts/Order.sol";
// import "./OrderStatus.sol";
// import "/dapp/orders/contracts/OrderLine.sol";
// import "/dapp/permissions/app/contracts/AppPermissionManager.sol";
// import "/dapp/products/contracts/Inventory.sol";

// contract OrderManager is RestStatus, OrderStatus {
//     AppPermissionManager appPermissionManager;

//     constructor(address _permissionManager) public {
//         appPermissionManager = AppPermissionManager(_permissionManager);
//     }

//     // struct OrderObject {
//     //         string _orderId
//     //     ,   string _buyerOrganization
//     //     ,   string _sellerOrganization
//     //     ,   uint _orderDate
//     //     ,   uint _orderTotal
//     //     ,   uint _orderShippingCharges
//     //     ,   OrderStatus _status
//     //     ,   uint _amountPaid
//     //     ,   string _buyerComments
//     //     ,   string _sellerComments
//     //     ,   uint _createdDate
//     //     ,   string _paymentSessionId
//     //     ,   address _shippingAddress
//     //     ,   address _inventoryAddress
//     // }

//     struct Order {
//         bytes32 orderId;
//         address buyerOrganization;
//         address sellerOrganization;
//         uint256 orderDate;
//         uint256 orderTotal;
//         uint256 orderShippingCharges;
//         uint256 status;
//         uint256 amountPaid;
//         string buyerComments;
//         string sellerComments;
//         uint256 createdDate;
//         string paymentSessionId;
//         string shippingAddress;
//     }

//     struct Inventory {
//         address inventoryId;
//         address ownerOrganization;
//         uint256 quantity;
//         uint256 pricePerUnit;
//         // Add other relevant fields here
//     }

//     struct InventoryGroup {
//         address ownerOrganization;
//         Inventory[] data;
//     }

//     mapping(bytes32 => Order) public orders;

//     function createOrder(
//         address[] memory inventoryIdArray,
//         uint256[] memory quantitiesToReduce,
//         address buyerOrganization,
//         uint256 recievedOrderTotal,
//         string memory paymentSessionId,
//         string memory shippingAddress
//     ) public returns (Order[] memory) {
//         require(
//             inventoryIdArray.length == quantitiesToReduce.length,
//             "Invalid input lengths"
//         );

//         uint256 currentTimestamp = block.timestamp;

//         uint256 createdDate = currentTimestamp;
//         uint256 orderDate = currentTimestamp;

//         if (bytes(paymentSessionId).length > 1) {
//             require(
//                 getOrdersCountByPaymentSessionId(paymentSessionId) == 0,
//                 string(
//                     abi.encodePacked(
//                         "Order already placed for payment_id ",
//                         paymentSessionId
//                     )
//                 )
//             );
//         }

//         Inventory[] memory inventories = getInventories(inventoryIdArray);

//         // event invent1(inventories);

//         require(
//             inventories.length == inventoryIdArray.length,
//             "Inventory not found"
//         );

//         for (uint256 i = 0; i < inventories.length; i++) {
//             require(
//                 buyerOrganization != inventories[i].ownerOrganization,
//                 "Seller cannot buy their own product"
//             );
//             inventories[i].quantity = quantitiesToReduce[i];
//         }

//         InventoryGroup[]
//             memory groupedData = groupInventoriesByOwnerOrganization(
//                 inventories
//             );

//         uint256 total = calculateOrderTotal(groupedData);

//         require(total == recievedOrderTotal, "Order Total is not matching");

//         Order.orderId[] ordersArray = new Order.orderId[](groupedData.length);

//         for (uint256 i = 0; i < groupedData.length; i++) {
//             InventoryGroup memory inventoryGroup = groupedData[i];

//             uint256 inventoryTotal = calculateInventoryTotal(
//                 inventoryGroup.data
//             );
//             uint256 shippingCharge = inventoryTotal * CHARGES.SHIPPING;
//             uint256 tax = inventoryTotal * CHARGES.TAX;

//             uint256 orderTotal = inventoryTotal + shippingCharge + tax;
//             uint256 amountPaid = orderTotal;

//             Order memory order = Order(
//                 uid(),
//                 buyerOrganization,
//                 inventoryGroup.ownerOrganization,
//                 orderDate,
//                 orderTotal,
//                 shippingCharge,
//                 1,
//                 amountPaid,
//                 "",
//                 "",
//                 createdDate,
//                 paymentSessionId,
//                 shippingAddress
//             );

//             orders[order.orderId] = order;
//             ordersArray[i] = order;

//             for (uint256 j = 0; j < inventoryGroup.data.length; j++) {
//                 Inventory memory inventory = inventoryGroup.data[j];

//                 // uint256 shippingCharges = (inventory.pricePerUnit *
//                 //     inventory.quantity) * CHARGES.SHIPPING;

//                 uint256 shippingCharges = (inventory.pricePerUnit *
//                     inventory.quantity) * 5;

//                 // uint256 tax = (inventory.pricePerUnit * inventory.quantity) *
//                 //     CHARGES.SHIPPING;

//                 uint256 tax = (inventory.pricePerUnit * inventory.quantity) * 5;

//                 addOrderLine(
//                     order.orderId,
//                     inventory.productId,
//                     inventory.inventoryId,
//                     inventory.quantity,
//                     inventory.pricePerUnit,
//                     shippingCharges,
//                     tax,
//                     createdDate
//                 );
//             }
//         }

//         updateInventoriesQuantities(inventoryIdArray, quantitiesToReduce, true);

//         return ordersArray;
//     }

//     function getOrdersCountByPaymentSessionId(
//         string memory paymentSessionId
//     ) internal view returns (uint256) {
//         uint256 count = 0;
//         // Implement the logic to count orders by payment session ID
//         return count;
//     }

//     mapping(bytes32 => mapping(uint256 => OrderLine)) public orderLines;

//     struct OrderLine {
//         bytes32 orderAddress;
//         address productId;
//         address inventoryId;
//         uint256 quantity;
//         uint256 pricePerUnit;
//         uint256 shippingCharges;
//         uint256 tax;
//         uint256 createdDate;
//     }

//     mapping(address => mapping(address => uint256)) public inventoryQuantities;

//     // Define other necessary mappings and variables

//     function getInventories(
//         address[] memory inventoryIds
//     ) internal view returns (Inventory[] memory) {
//         Inventory[] memory inventories = new Inventory[](inventoryIds.length);
//         // Implement the logic to fetch inventories based on the provided inventory IDs
//         return inventories;
//     }

//     function groupInventoriesByOwnerOrganization(
//         Inventory[] memory inventories
//     ) internal pure returns (InventoryGroup[] memory) {
//         InventoryGroup[] memory groupedData = new InventoryGroup[](
//             inventories.length
//         );
//         // Implement the logic to group inventories by owner organization
//         return groupedData;
//     }

//     function calculateOrderTotal(
//         InventoryGroup[] memory inventoriesData
//     ) internal pure returns (uint256) {
//         uint256 total = 0;
//         // Implement the logic to calculate the order total based on the grouped inventories data
//         return total;
//     }

//     function calculateInventoryTotal(
//         Inventory[] memory inventories
//     ) internal pure returns (uint256) {
//         uint256 total = 0;
//         // Implement the logic to calculate the inventory total based on the provided inventories
//         return total;
//     }

//     // function addOrderLine(
//     //     bytes32 orderAddress,
//     //     address productId,
//     //     address inventoryId,
//     //     uint256 quantity,
//     //     uint256 pricePerUnit,
//     //     uint256 shippingCharges,
//     //     uint256 tax,
//     //     uint256 createdDate
//     // ) internal {
//     //     OrderLine memory orderLine = OrderLine(
//     //         orderAddress,
//     //         productId,
//     //         inventoryId,
//     //         quantity,
//     //         pricePerUnit,
//     //         shippingCharges,
//     //         tax,
//     //         createdDate
//     //     );
//     //     // Implement the logic to add the order line to the orderLines mapping
//     // }

//     function updateInventoriesQuantities(
//         address[] memory inventoryIds,
//         uint256[] memory quantities,
//         bool isReduce
//     ) internal {
//         require(
//             inventoryIds.length == quantities.length,
//             "Invalid input lengths"
//         );
//         // Implement the logic to update the inventory quantities based on the provided inventory IDs and quantities
//     }

//     function uid() internal pure returns (bytes32) {
//         // Implement the logic to generate a unique ID
//         return bytes32(0);
//     }

//     // Define other necessary functions and constants

//     // Define other necessary constants

//     // function createOrder(
//     //         string _orderId
//     //     ,   string _buyerOrganization
//     //     ,   string _sellerOrganization
//     //     ,   uint _orderDate
//     //     ,   uint _orderTotal
//     //     ,   uint _orderShippingCharges
//     //     ,   OrderStatus _status
//     //     ,   uint _amountPaid
//     //     ,   string _buyerComments
//     //     ,   string _sellerComments
//     //     ,   uint _createdDate
//     //     ,   string _paymentSessionId
//     //     ,   address _shippingAddress
//     //     ,   address _inventoryAddress) public returns (uint256, address){
//     //     Order order = new Order( _orderId, _buyerOrganization,_sellerOrganization, _orderDate,_orderTotal,_orderShippingCharges,_status,_amountPaid,_buyerComments,_sellerComments,_createdDate,_paymentSessionId,_shippingAddress);

//     //     Inventory inventory = Inventory(_inventoryAddress);
//     //     return (RestStatus.CREATED, address(order));
//     // }
// }
