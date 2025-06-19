const AddressComponent = ({ userAddress }) => {
  return (
    <div className="flex flex-col gap-[10px] px-1">
      <div className="flex justify-between">
        <p>Name</p>
        <p className="text-right   font-semibold">
          {decodeURIComponent(userAddress.name)}
        </p>
      </div>
      <div className="flex justify-between">
        <p className="text-[#000000] text-sm">Address</p>
        <p className="text-right text-[#000000] text-sm font-semibold">
          {' '}
          {userAddress.addressLine2
            ? decodeURIComponent(userAddress.addressLine1) +
              ', ' +
              decodeURIComponent(userAddress.addressLine2)
            : decodeURIComponent(userAddress.addressLine1)}
        </p>
      </div>
      <div className="flex justify-between">
        <p className="text-[#000000] text-sm">City</p>
        <p className="text-right text-[#000000] text-sm font-semibold">
          {decodeURIComponent(userAddress.city)}{' '}
        </p>
      </div>
      <div className="flex justify-between">
        <p className="text-[#000000] text-sms">State</p>
        <p className="text-right text-[#000000] text-sm font-semibold">
          {decodeURIComponent(userAddress.state)}{' '}
        </p>
      </div>
      <div className="flex justify-between">
        <p className="text-[#000000] text-sm">Zipcode</p>
        <p className="text-right text-[#000000] text-sm  font-semibold">
          {userAddress.zipcode}{' '}
        </p>
      </div>
    </div>
  );
};

export default AddressComponent;
