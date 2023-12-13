const AddressComponent = ({ userAddress }) => {
    return (
        
        <div className="flex  flex-col gap-[10px]">
<div className="flex justify-between">
    <p>Name</p>
        <p className="text-left w-[168px]  font-semibold">{decodeURIComponent(userAddress.shippingName)}</p>
    </div> 
     <div className="flex justify-between">
    <p>Address</p>
        <p className="text-left w-[168px] font-semibold"> { userAddress.shippingAddressLine2 ?
                        decodeURIComponent(userAddress.shippingAddressLine1)+", "+decodeURIComponent(userAddress.shippingAddressLine2) 
                        : decodeURIComponent(userAddress.shippingAddressLine1)
                    }</p>
    </div>   
     <div className="flex justify-between">
    <p>City</p>
        <p className="text-left w-[168px] font-semibold">{decodeURIComponent(userAddress.shippingCity)} </p>
    </div>   
     <div className="flex justify-between">
    <p>State</p>
        <p className="text-left w-[168px] font-semibold">{decodeURIComponent(userAddress.shippingState)} </p>
    </div> 
    <div className="flex justify-between">
    <p>Zipcode</p>
        <p className="text-left w-[168px] font-semibold">{userAddress.shippingZipcode} </p>
    </div>            

        </div>

    );
}

export default AddressComponent;