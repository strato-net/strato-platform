import MyAssetCard from "./MyAssetCard";

const InactiveTab = (products) => {
    
    return (
        <div>
            {products.products.length !== 0 ? (
                <div className="flex flex-wrap my-4 gap-8">
                    {products.products.map((product, index) => {
                        return (
                            <MyAssetCard
                                product={product}
                                key={index}
                            />
                        );
                    })}
                </div>
            ) : (
                <p className="flex justify-center my-10"> No data found</p>
            )}
        </div>
    )
}


export default InactiveTab