import React from 'react';
import './Statistics.css';
const Statistics = ({ priceHistory, is18DecimalPlaces }) => {
  // Origin Asset Statistics
  const originFluctuation = priceHistory.records.originFluctuation;
  const originVolume = priceHistory.records.originVolume;
  const originAveragePrice = priceHistory.records.originAveragePrice.toFixed(2);

  return (
    <div className="container">
      <div className="flex justify-center -mx-9 md:flex-nowrap flex-wrap">
        {/* Tile for Price Range */}
        <div className="tileWrapper p-2 flex-auto md:max-w-[calc(33.333%-1.5rem)] w-full">
          <div className="tile bg-gray-200 p-4 rounded-lg shadow-md text-center">
            <p className="statistics-title text-2xl font-semibold">
              ${is18DecimalPlaces ? originFluctuation.min * Math.pow(10, 18) : originFluctuation.min}
              - $
              {is18DecimalPlaces ? originFluctuation.max * Math.pow(10, 18): originFluctuation.max}
            </p>
            <p className="subtitle text-gray-600">12-Month Price Range</p>
          </div>
        </div>

        {/* Tile for Number of Units Sold */}
        <div className="tileWrapper p-2 flex-auto md:max-w-[calc(33.333%-1.5rem)] w-full">
          <div className="tile bg-gray-200 p-4 rounded-lg shadow-md text-center">
            <p className="statistics-title text-2xl font-semibold">{is18DecimalPlaces ? (originVolume / Math.pow(10, 18)).toFixed(0) : originVolume.toFixed(0) }</p>
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
