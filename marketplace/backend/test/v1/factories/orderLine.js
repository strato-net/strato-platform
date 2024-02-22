import constants from '../../../helpers/constants';
const zeroAddress = constants.zeroAddress;
// const zeroAddress=''.padStart(40,'0')
const factory={
  getCreateOrderArgs(uid,buyerOrganization="",inventories=[],orderTotal){
    const args = {
      buyerOrganization,
      orderList:inventories.map(inventory=>({
       inventoryId:inventory,
       quantity:2 
      })),
      orderTotal:40,
      shippingAddress: zeroAddress

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