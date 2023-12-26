const AddressComponent = ({ userAddress }) => {
    return (
        
        <div className="flex  flex-col gap-[10px]">
            <div className="flex justify-between">
                <p>Name</p>
                    <p className="text-left w-[168px]  font-semibold">{decodeURIComponent(userAddress.name)}</p>
            </div> 
            <div className="flex justify-between">
                <p>Address</p>
                    <p className="text-left w-[168px] font-semibold"> { userAddress.addressLine2 ?
                                    decodeURIComponent(userAddress.addressLine1)+", "+decodeURIComponent(userAddress.addressLine2) 
                                    : decodeURIComponent(userAddress.addressLine1)
                                }</p>
            </div>   
            <div className="flex justify-between">
                <p>City</p>
                    <p className="text-left w-[168px] font-semibold">{decodeURIComponent(userAddress.city)} </p>
            </div>   
            <div className="flex justify-between">
                <p>State</p>
                    <p className="text-left w-[168px] font-semibold">{decodeURIComponent(userAddress.state)} </p>
            </div> 
            <div className="flex justify-between">
                <p>Zipcode</p>
                    <p className="text-left w-[168px] font-semibold">{userAddress.zipcode} </p>
            </div>            

        </div>

    );
}

export default AddressComponent;