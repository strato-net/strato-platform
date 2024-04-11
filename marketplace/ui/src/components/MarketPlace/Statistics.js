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

// Origin Asset Statistics
const originFluctuation = calculatePriceFluctuation(priceHistory.records);
const originVolume = calculateVolumeTraded(priceHistory.records);
const originAveragePrice = calculateAveragePrice(priceHistory.records);

return (
  <div className="container">
  <div className="flex justify-center mx-2 md:flex-nowrap flex-wrap">
    {/* Tile for Price Range */}
    <div className="tileWrapper p-2 flex-auto md:max-w-[calc(33.333%-1rem)] w-full">
      <div className="tile bg-gray-200 p-4 rounded-lg shadow-md text-center">
        <p className="title text-2xl font-semibold">${originFluctuation.min} - ${originFluctuation.max}</p>
        <p className="subtitle text-gray-600">12-Month Price Range</p>
      </div>
    </div>
    
    {/* Tile for Number of Units Sold */}
    <div className="tileWrapper p-2 flex-auto md:max-w-[calc(33.333%-1rem)] w-full">
      <div className="tile bg-gray-200 p-4 rounded-lg shadow-md text-center">
        <p className="title text-2xl font-semibold">{originVolume}</p>
        <p className="subtitle text-gray-600">Number Of Units Sold</p>
      </div>
    </div>

    {/* Tile for Average Price */}
    <div className="tileWrapper p-2 flex-auto md:max-w-[calc(33.333%-1rem)] w-full">
      <div className="tile bg-gray-200 p-4 rounded-lg shadow-md text-center">
        <p className="title text-2xl font-semibold">${originAveragePrice.toFixed(2)}</p>
        <p className="subtitle text-gray-600">Average Sale Price</p>
      </div>
    </div>
  </div>
</div>


  );
};

export default Statistics;
