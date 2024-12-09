import React from 'react';
import './Statistics.css';
const Statistics = ({ priceHistory, isDecimal }) => {
  // Origin Asset Statistics
  const originFluctuation = priceHistory.records.originFluctuation;
  const originVolume = isDecimal
    ? priceHistory.records.originVolume / 100
    : priceHistory.records.originVolume;
  const originAveragePrice = isDecimal
    ? (priceHistory.records.originAveragePrice * 100).toFixed(2)
    : priceHistory.records.originAveragePrice.toFixed(2);

  return (
    <div className="container">
      <div className="flex justify-center -mx-9 md:flex-nowrap flex-wrap">
        {/* Tile for Price Range */}
        <div className="tileWrapper p-2 flex-auto md:max-w-[calc(33.333%-1.5rem)] w-full">
          <div className="tile bg-gray-200 p-4 rounded-lg shadow-md text-center">
            <p className="statistics-title text-2xl font-semibold">
              ${isDecimal ? originFluctuation.min * 100 : originFluctuation.min}{' '}
              - $
              {isDecimal ? originFluctuation.max * 100 : originFluctuation.max}
            </p>
            <p className="subtitle text-gray-600">12-Month Price Range</p>
          </div>
        </div>

        {/* Tile for Number of Units Sold */}
        <div className="tileWrapper p-2 flex-auto md:max-w-[calc(33.333%-1.5rem)] w-full">
          <div className="tile bg-gray-200 p-4 rounded-lg shadow-md text-center">
            <p className="statistics-title text-2xl font-semibold">{originVolume}</p>
            <p className="subtitle text-gray-600">Number Of Units Sold</p>
          </div>
        </div>

        {/* Tile for Average Price */}
        <div className="tileWrapper p-2 flex-auto md:max-w-[calc(33.333%-1.5rem)] w-full">
          <div className="tile bg-gray-200 p-4 rounded-lg shadow-md text-center">
            <p className="statistics-title text-2xl font-semibold">
              ${originAveragePrice}
            </p>
            <p className="subtitle text-gray-600">Average Sale Price</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Statistics;
