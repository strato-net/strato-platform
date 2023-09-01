import { Button } from "antd";
import { useEffect, useState } from "react";


const MyAssetCard = (product, index) => {
    const [status, setStatus] = useState("Purchased");
    let statusBackgroundColor;

    // Temporary useEffect used to switch through the different status cards
    useEffect(() => {
        setStatus("Purchased");
    }, [])

    switch (status) {
        case "For Sale":
            statusBackgroundColor = "#92A2FB";
            break;
        case "Retired":
            statusBackgroundColor = "#F98C8C";
            break;
        case "Unpublished":
            statusBackgroundColor = "#F0C452";
            break;
        case "Sold":
            statusBackgroundColor = "#92FBFB";
            break;
        default:
            statusBackgroundColor = "#36C487";
    }


    return (
        <div
            className="h-[350px] w-72 bg-white drop-shadow-md"
        >
            <div className="p-2 bg-white absolute top-0 right-0 font-semibold">
                2023
            </div>
            <div className="flex flex-col">
                <img
                    className="h-36"
                    src={product.product.imageUrl}
                    alt="Card image..."
                />
                <p className="font-bold text-center">
                    {decodeURIComponent(product.product.name)}
                </p>
                <div className="flex mx-2 absolute bottom-28">
                    <div className="py-1.5 px-4 text-black font-semibold rounded-full" style={{ backgroundColor: statusBackgroundColor }}>
                        {status}
                    </div>
                </div>
                <div className="flex justify-between mx-2 absolute bottom-[84px]">
                    <div className="flex font-bold absolute left-1">
                        100cr
                    </div>
                    <div className="flex font-bold absolute left-56">
                        $23/cr
                    </div>
                </div>
                {status === "Purchased" &&
                    <div className="flex justify-between gap-2 mx-2 absolute bottom-3">
                        <Button
                            className="h-10 w-32 border border-primary hover:bg-primary text-primary"
                        >
                            Retire
                        </Button>
                        <Button
                            type="primary"
                            className="h-10 w-32"
                        >
                            Sell
                        </Button>
                    </div>
                }
                {status === "For Sale" &&
                    <div className="absolute bottom-3 w-full">
                        <Button
                            type="primary"
                            className="h-10 w-11/12 ml-3"
                        >
                            Edit
                        </Button>
                    </div>
                }
                {status === "Retired" &&
                    <div className="absolute bottom-3 ml-2">
                        Retired on 9/13/2023
                    </div>
                }
                {status === "Unpublished" &&
                    <div className="absolute bottom-3 w-full">
                        <Button
                            type="primary"
                            className="h-10 w-11/12 ml-3"
                        >
                            Edit
                        </Button>
                    </div>
                }
                {status === "Sold" &&
                    <div className="absolute bottom-3 w-full">
                        <Button
                            type="primary"
                            className="h-10 w-11/12 ml-3"
                        >
                            Edit
                        </Button>
                    </div>
                }
            </div>
        </div>
    )
}


export default MyAssetCard;