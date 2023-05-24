const zeroAddress=''.padStart(40,'0')
const factory={
  getCreateOrderArgs(uid,buyerOrganization="",inventories=[]){
    const args = {
      buyerOrganization,
      orderList:inventories.map(inventory=>({
       inventoryId:inventory,
       quantity:2
      })),
      orderTotal:40,
      shippingAddress: '0000000000000000000000000000000000000000'
    }
    return args
  },

  getCreateOrderLineItemsArgs(orderId,orderAddress,orderLineId="",serialNumber=[]){
    const args={
      orderId,
      orderAddress,
      orderLineId,
      serialNumber
    }
    return args
  }
}



export default factory;