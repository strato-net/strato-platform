import { Tooltip } from 'antd';
import image_placeholder from '../../images/resources/image_placeholder.png';
import routes from '../../helpers/routes';
import { Images } from '../../images';
import StakeItemActions from '../Inventory/StakeItemActions';
import ChildStakeItemActions from '../Inventory/ChildStakeItemActions';
import { ASSET_STATUS } from '../../helpers/constants';

const logo = <img src={Images.cata} alt={''} title={''} className="w-5 h-5" />;
const StratsIcon = (
  <img src={Images.strat} alt={''} title={''} className="w-4 h-4" />
);

// Make sure you have any necessary variables or functions defined/imported
// You may need to pass user, limit, offset, reserves, stratsAddress, cataAddress as params,
// or handle them in the file where you call these columns.

export const aggregateStakeColumns = (
  user,
  limit,
  offset,
  reserves,
  stratsAddress,
  cataAddress
) => {
  return [
    {
      title: 'Item',
      render: (_, record) => {
        const uniqueBorrowedAddresses = new Set();

        const borrowedAmount =
          (record?.inventories
            ? record.inventories.reduce((sum, item) => {
                const escrowAddress = item?.escrow?.address;
                const borrowedValue = item?.escrow?.borrowedAmount || 0;

                // Add borrowed amount only if the escrow address is unique
                if (
                  escrowAddress &&
                  !uniqueBorrowedAddresses.has(escrowAddress)
                ) {
                  uniqueBorrowedAddresses.add(escrowAddress);
                  return sum + borrowedValue;
                }

                return sum;
              }, 0)
            : record?.escrow?.borrowedAmount || 0) / 100;
        return (
          <>
            <div className="flex items-center">
              <div className="mr-2 w-[74px] h-[52px] flex items-center justify-center">
                <img
                  src={
                    record['BlockApps-Mercata-Asset-images'] &&
                    record['BlockApps-Mercata-Asset-images'].length > 0
                      ? record['BlockApps-Mercata-Asset-images'][0].value
                      : image_placeholder
                  }
                  alt={'Asset image...'}
                  className="rounded-md w-full h-full object-contain"
                />
              </div>
              <div>
                <span className="text-xs sm:text-sm text-[#13188A]">
                  <Tooltip title={record.name}>
                    <span className="w-48 whitespace-nowrap overflow-hidden text-ellipsis block">
                      {record.name}
                    </span>
                  </Tooltip>
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              Borrowed Amount: {StratsIcon}
              {borrowedAmount.toLocaleString('en-US', {
                maximumFractionDigits: 2,
                minimumFractionDigits: 2,
              })}
            </div>
          </>
        );
      },
    },
    {
      title: 'Owned',
      align: 'center',
      render: (_, record) => {
        return <div>{record.totalQuantity || 0}</div>;
      },
    },
    {
      title: 'Quantity Stakeable',
      align: 'center',
      render: (_, record) => {
        const uniqueEscrows = new Set();
        const collateralQuantity = record?.inventories
          ? record.inventories.reduce((sum, item) => {
              const escrowAddress = item?.escrow?.address;
              const escrowCollateral = item?.escrow?.collateralQuantity || 0;

              // Add collateral only if the escrow address is unique
              if (escrowAddress && !uniqueEscrows.has(escrowAddress)) {
                uniqueEscrows.add(escrowAddress);
                return sum + escrowCollateral;
              }

              return sum;
            }, 0)
          : record?.escrow?.collateralQuantity > record?.quantity
          ? record?.quantity
          : record?.escrow?.collateralQuantity || 0;
        const quantityNotAvailable =
          record.inventories.reduce((sum, item) => {
            const status = Number(item.status);
            if (status && status !== ASSET_STATUS.ACTIVE) {
              return sum + (item.quantity || 0);
            }
            return sum;
          }, 0) + record.totalSaleQuantity;
        const stakeableQuantity =
          record.totalQuantity - collateralQuantity - quantityNotAvailable;
        return <div>{stakeableQuantity}</div>;
      },
    },
    {
      title: 'Quantity Staked',
      align: 'center',
      render: (_, record) => {
        const uniqueEscrows = new Set();
        const collateralQuantity = record?.inventories
          ? record.inventories.reduce((sum, item) => {
              const escrowAddress = item?.escrow?.address;
              const escrowCollateral = item?.escrow?.collateralQuantity || 0;
      
              // Add collateral only if the escrow address is unique
              if (escrowAddress && !uniqueEscrows.has(escrowAddress)) {
                uniqueEscrows.add(escrowAddress);
                return sum + escrowCollateral;
              }
      
              return sum;
            }, 0)
          : record?.escrow?.collateralQuantity > record?.quantity
          ? record?.quantity
          : record?.escrow?.collateralQuantity || 0;
        return <div>{collateralQuantity}</div>;
      },
    },
    {
      title: 'Actions',
      align: 'center',
      render: (text, record) => (
        <div>
          <StakeItemActions
            inventory={record}
            limit={limit}
            offset={offset}
            debouncedSearchTerm={''}
            user={user}
            reserves={reserves}
            stratAddress={stratsAddress}
            cataAddress={cataAddress}
          />
        </div>
      ),
    },
    {
      title: 'Status',
      align: 'center',
      render: (_, record) => {
        const escrows = record?.inventories
        ? [
            ...new Set(
              record.inventories
                .map((item) => item?.escrow?.address)
                .filter(Boolean)
            ),
          ]
        : record?.escrow?.address
        ? [record.escrow.address]
        : [];
        const isStaked = escrows.length > 0;
        return (
          <div className="pt-[7px] lg:pt-0 items-center gap-[5px]">
            {isStaked ? (
              <div className="flex items-center justify-center gap-2 bg-[#1548C329] p-[6px] rounded-md">
                <div className="w-[7px] h-[7px] rounded-full bg-[#119B2D]"></div>
                <p className="text-[#4D4D4D] text-[13px]">Staked</p>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 bg-[#1548C329] p-[6px] rounded-md">
                <div className="w-[7px] h-[7px] rounded-full bg-[#ff4d4f]"></div>
                <p className="text-[#4D4D4D] text-[13px]">Unstaked</p>
              </div>
            )}
          </div>
        );
      },
    },
  ];
};

export const stakeColumns = (
  user,
  limit,
  offset,
  reserves,
  stratsAddress,
  cataAddress,
  navigate
) => {
  return [
    {
      title: 'Item',
      render: (_, record) => {
        const callDetailPage = () => {
          navigate(
            `${routes.InventoryDetail.url
              .replace(':id', record.address)
              .replace(':name', encodeURIComponent(record.name))}`,
            {
              state: { isCalledFromInventory: true },
            }
          );
        };
        return (
          <>
            <div className="flex items-center">
              <div className="mr-2 w-[74px] h-[52px] flex items-center justify-center">
                <img
                  src={
                    record['BlockApps-Mercata-Asset-images'] &&
                    record['BlockApps-Mercata-Asset-images'].length > 0
                      ? record['BlockApps-Mercata-Asset-images'][0].value
                      : image_placeholder
                  }
                  alt={'Asset image...'}
                  className="rounded-md w-full h-full object-contain"
                />
              </div>
              <div>
                <span
                  className="text-xs sm:text-sm text-[#13188A] hover:underline cursor-pointer"
                  onClick={callDetailPage}
                >
                  <Tooltip title={record.name}>
                    <span className="w-48 whitespace-nowrap overflow-hidden text-ellipsis block">
                      {record.name}
                    </span>
                  </Tooltip>
                </span>
              </div>
            </div>
          </>
        );
      },
    },
    {
      title: 'Owned',
      align: 'center',
      render: (_, record) => {
        return <div>{record.quantity || 0}</div>;
      },
    },
    {
      title: 'Quantity Stakeable',
      align: 'center',
      render: (_, record) => {
        const isActive = () => {
          if (
            record.status == ASSET_STATUS.PENDING_REDEMPTION ||
            record.status == ASSET_STATUS.RETIRED ||
            record?.saleQuantity
          ) {
            return false;
          } else {
            return true;
          }
        };
        const matchingQuantity = record?.escrow?.[
          'BlockApps-Mercata-Escrow-assets'
        ]?.find((item) => item.value === record.address)
          ? record.quantity
          : 0;
        return (
          <div>{!isActive() ? 0 : record.quantity - matchingQuantity}</div>
        );
      },
    },
    {
      title: 'Quantity Staked',
      align: 'center',
      render: (_, record) => {
        const matchingQuantity = record?.escrow?.[
          'BlockApps-Mercata-Escrow-assets'
        ]?.find((item) => item.value === record.address)
          ? record.quantity
          : 0;
        return <div>{matchingQuantity}</div>;
      },
    },
    {
      title: 'Actions',
      align: 'center',
      render: (text, record) => (
        <ChildStakeItemActions
          inventory={record}
          limit={limit}
          offset={offset}
          debouncedSearchTerm={''}
          user={user}
          reserves={reserves}
          stratAddress={stratsAddress}
          cataAddress={cataAddress}
        />
      ),
    },
    {
      title: 'Status',
      align: 'center',
      render: (text, record) => {
        const matchingQuantity = record?.escrow?.[
          'BlockApps-Mercata-Escrow-assets'
        ]?.find((item) => item.value === record.address)
          ? record.quantity
          : 0;
        const isStaked = matchingQuantity > 0;
        const isPublished = !isStaked && record?.price > 0;

        return (
          <div className="pt-[7px] lg:pt-0 items-center gap-[5px]">
            {isStaked ? (
              <div className="flex items-center justify-center gap-2 bg-[#1548C329] p-[6px] rounded-md">
                <div className="w-[7px] h-[7px] rounded-full bg-[#119B2D]"></div>
                <p className="text-[#4D4D4D] text-[13px]">Staked</p>
              </div>
            ) : record.status == ASSET_STATUS.PENDING_REDEMPTION ? (
              <div className="flex items-center justify-center gap-2 bg-[#FFA50029] p-[6px] rounded-md">
                <div className="w-[8px] h-[7px] rounded-full bg-[#FFA500]"></div>
                <p className="text-[#4D4D4D] text-[13px]">Pending Redemption</p>
              </div>
            ) : record.status == ASSET_STATUS.RETIRED ? (
              <div className="flex items-center justify-center gap-2 bg-[#c3152129] p-[6px] rounded-md">
                <div className="w-[7px] h-[7px] rounded-full bg-[#ff4d4f]"></div>
                <p className="text-[#4D4D4D] text-[13px]">Retired</p>
              </div>
            ) : isPublished ? (
              <div className="flex items-center justify-center gap-2 bg-[#1548C329] p-[6px] rounded-md">
                <div className="w-[7px] h-[7px] rounded-full bg-[#119B2D]"></div>
                <p className="text-[#4D4D4D] text-[13px]">Published</p>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 bg-[#1548C329] p-[6px] rounded-md">
                <div className="w-[7px] h-[7px] rounded-full bg-[#ff4d4f]"></div>
                <p className="text-[#4D4D4D] text-[13px]">Unstaked</p>
              </div>
            )}
          </div>
        );
      },
    },
  ];
};
