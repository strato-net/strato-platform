import React from 'react';
import './Statistics.css';
const Statistics = ({ priceHistory }) => {

const calculateAveragePrice = (records) => records.reduce((sum, record) => sum + record.price, 0) / records.length;

const calculatePriceFluctuation = (records) => {
  const prices = records.map(record => record.price);
  return { min: Math.min(...prices), max: Math.max(...prices) };
};

const calculateVolumeTraded = (records) => {
  
    // Use reduce to accumulate the total volume traded
    return records.reduce((acc, record, index, array) => {
      // Skip the first element since it has no previous to compare with
      if (index === 0) return acc;
  
      // Compare the current record with the previous one
      const quantityDecrease = array[index - 1].quantity - record.quantity;
  
      // If the quantity has decreased, add it to the accumulator
      if (quantityDecrease > 0) {
        acc += quantityDecrease;
      }
      
      return acc; 
    }, 0); 
}

const calculatePriceAppreciation = (currentRecords, originRecords) => {
  const currentAverage = calculateAveragePrice(currentRecords);
  const originAverage = calculateAveragePrice(originRecords);
  return ((currentAverage - originAverage) / originAverage) * 100;
};

// Current Asset Statistics
const currentFluctuation = calculatePriceFluctuation(priceHistory.records);
const currentVolume = calculateVolumeTraded(priceHistory.records);

const currentAveragePrice = calculateAveragePrice(priceHistory.records);

// Origin Asset Statistics
const originFluctuation = calculatePriceFluctuation(priceHistory.originRecords);
const originVolume = calculateVolumeTraded(priceHistory.originRecords);
const originAveragePrice = calculateAveragePrice(priceHistory.originRecords);

const priceAppreciation = calculatePriceAppreciation(priceHistory.records, priceHistory.originRecords);
return (
    <div className="container">
      <div className="flex flex-wrap justify-center -mx-2">
        
        {/* Tile for Current Trade Price Range */}
        <div className="tileWrapper p-2 lg:w-1/3 md:w-1/2 w-full">
          <div className="tile bg-gray-200 p-4 rounded-lg shadow-md text-center">
            <p className="title text-2xl font-semibold">${currentFluctuation.min} - ${currentFluctuation.max}</p>
            <p className="subtitle text-gray-600">Current Trade Price Range</p>
          </div>
        </div>
        
        {/* Tile for Volume of Current Trades */}
        <div className="tileWrapper p-2 lg:w-1/3 md:w-1/2 w-full">
          <div className="tile bg-gray-200 p-4 rounded-lg shadow-md text-center">
            <p className="title text-2xl font-semibold">{currentVolume}</p>
            <p className="subtitle text-gray-600">Volume of Current Trades</p>
          </div>
        </div>

        {/* Tile for Average Current Trade Price */}
        <div className="tileWrapper p-2 lg:w-1/3 md:w-1/2 w-full">
          <div className="tile bg-gray-200 p-4 rounded-lg shadow-md text-center">
            <p className="title text-2xl font-semibold">${currentAveragePrice.toFixed(2)}</p>
            <p className="subtitle text-gray-600">Average Current Trade Price</p>
          </div>
        </div>

        {/* Tile for Original Trade Price Range */}
        <div className="tileWrapper p-2 lg:w-1/3 md:w-1/2 w-full">
          <div className="tile bg-gray-200 p-4 rounded-lg shadow-md text-center">
            <p className="title text-2xl font-semibold">${originFluctuation.min} - ${originFluctuation.max}</p>
            <p className="subtitle text-gray-600">Original Trade Price Range</p>
          </div>
        </div>

        {/* Tile for Volume of Original Trades */}
        <div className="tileWrapper p-2 lg:w-1/3 md:w-1/2 w-full">
          <div className="tile bg-gray-200 p-4 rounded-lg shadow-md text-center">
            <p className="title text-2xl font-semibold">{originVolume}</p>
            <p className="subtitle text-gray-600">Volume of Original Trades</p>
          </div>
        </div>

        {/* Tile for Average Original Trade Price */}
        <div className="tileWrapper p-2 lg:w-1/3 md:w-1/2 w-full">
          <div className="tile bg-gray-200 p-4 rounded-lg shadow-md text-center">
            <p className="title text-2xl font-semibold">${originAveragePrice.toFixed(2)}</p>
            <p className="subtitle text-gray-600">Average Original Trade Price</p>
          </div>
        </div>

        {/* Tile for Price Appreciation */}
        <div className="tileWrapper p-2 lg:w-1/3 md:w-1/2 w-full">
          <div className="tile bg-gray-200 p-4 rounded-lg shadow-md text-center">
            <p className="title text-2xl font-semibold">{priceAppreciation.toFixed(2)}%</p>
            <p className="subtitle text-gray-600">Price Appreciation</p>
          </div>
        </div>

      </div>
    </div>
  );
//   return (
//     <div className="container mx-auto p-4">
//       <div className="flex flex-wrap -mx-2 justify-center">
//         {/* Tile for Current Trade Price Range */}
//         <div className="p-2 lg:w-1/3 md:w-1/2 w-full">
//           <div className="bg-gray-200 p-4 rounded-lg shadow-md text-center">
//             <p className="text-2xl font-semibold">${currentFluctuation.min} - ${currentFluctuation.max}</p>
//             <p className="text-gray-600">Current Trade Price Range</p>
//           </div>
//         </div>

//           {/* Tile for Volume of Current Trades */}
//           <div className="p-2 lg:w-1/3 md:w-1/2 w-full">
//             <div className="bg-gray-200 p-4 rounded-lg shadow-md text-center">
//                 <p className="text-2xl font-semibold">{currentVolume}</p>
//                 <p className="text-gray-600">Volume of Current Trades</p>
//             </div>
//         </div>

//         {/* Tile for Average Current Trade Price */}
//         <div className="p-2 lg:w-1/3 md:w-1/2 w-full">
//           <div className="bg-gray-200 p-4 rounded-lg shadow-md text-center">
//             <p className="text-2xl font-semibold">${currentAveragePrice.toFixed(2)}</p>
//             <p className="text-gray-600">Average Current Trade Price</p>
//           </div>
//         </div>

//         {/* Tile for Original Trade Price Range */}
//         <div className="p-2 lg:w-1/3 md:w-1/2 w-full">
//           <div className="bg-gray-200 p-4 rounded-lg shadow-md text-center">
//             <p className="text-2xl font-semibold">${originFluctuation.min} - ${originFluctuation.max}</p>
//             <p className="text-gray-600">Origin Trade Price Range</p>
//           </div>
//         </div>

      
//         {/* Tile for Volume of Original Trades */}
//         <div className="p-2 lg:w-1/3 md:w-1/2 w-full">
//           <div className="bg-gray-200 p-4 rounded-lg shadow-md text-center">
//             <p className="text-2xl font-semibold">{originVolume}</p>
//             <p className="text-gray-600">Volume of Origin Trades</p>
//           </div>
//         </div>

        

//         {/* Tile for Average Original Trade Price */}
//         <div className="p-2 lg:w-1/3 md:w-1/2 w-full">
//           <div className="bg-gray-200 p-4 rounded-lg shadow-md text-center">
//             <p className="text-2xl font-semibold">${originAveragePrice.toFixed(2)}</p>
//             <p className="text-gray-600">Average Origin Trade Price</p>
//           </div>
//         </div>

//         {/* Tile for Price Appreciation */}
//         <div className="p-2 lg:w-1/3 md:w-1/2 w-full">
//           <div className="bg-gray-200 p-4 rounded-lg shadow-md text-center">
//             <p className="text-2xl font-semibold">{priceAppreciation.toFixed(2)}%</p>
//             <p className="text-gray-600">Price Appreciation</p>
//           </div>
//         </div>
       
//       </div>
//     </div>
//   );
};

export default Statistics;
