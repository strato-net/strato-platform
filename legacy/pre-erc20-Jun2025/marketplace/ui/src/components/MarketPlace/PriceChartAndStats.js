import React from 'react';
import ReactApexChart from 'react-apexcharts';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

const PriceChartAndStats = ({
  isFetchingPriceHistory,
  priceHistory
}) => {
  if (
    isFetchingPriceHistory ||
    !priceHistory ||
    !priceHistory.originRecords ||
    priceHistory.originRecords.length === 0
  ) {
    return <div className="h-full bg-gray-200 animate-pulse"></div>;
  }

  const fillDataGaps = (records) => {
    const filledData = [];
    let lastKnownPrice = null;

    for (let i = 0; i < records.length; i++) {
      const currentRecord = records[i];
      const isoDate = currentRecord.block_timestamp.replace(' UTC', 'Z');
      const date = dayjs(isoDate).utc();
      const price = currentRecord.price;

      // Set the last known price if it's null (first iteration) or update it to the current record's price
      if (lastKnownPrice === null || price !== lastKnownPrice) {
        lastKnownPrice = price;
      }

      // Push the current record with the last known price
      filledData.push({
        x: date.valueOf(),
        y: lastKnownPrice,
      });

      // If this is not the last record, fill the gap until the next record's date
      if (i < records.length - 1) {
        const nextIsoDate = records[i + 1].block_timestamp.replace(' UTC', 'Z');
        const nextDate = dayjs(nextIsoDate).utc();
        let currentDate = date.add(1, 'day');

        // Fill in the gaps with the last known price
        while (currentDate.isBefore(nextDate, 'day')) {
          filledData.push({
            x: currentDate.valueOf(),
            y: lastKnownPrice, // Use the last known price instead of resetting it to the first record's price
          });
          currentDate = currentDate.add(1, 'day');
        }
      }
    }

    // Check if last record's date is the current date
    const lastRecordDate = dayjs(filledData[filledData.length - 1].x);
    const today = dayjs().utc().endOf('day');
    if (!lastRecordDate.isSame(today, 'day')) {
      // Fill the gap until the current date with the last known price
      let currentDate = lastRecordDate.add(1, 'day');
      while (
        currentDate.isBefore(today, 'day') ||
        currentDate.isSame(today, 'day')
      ) {
        filledData.push({
          x: currentDate.valueOf(),
          y: lastKnownPrice,
        });
        currentDate = currentDate.add(1, 'day');
      }
    }

    return filledData;
  };

  const filledSeriesData = fillDataGaps(priceHistory.originRecords);
  const useCategory = filledSeriesData.length <= 7;
  const singleDataPoint = filledSeriesData.length === 1;

  const options = {
    chart: {
      type: 'area',
      toolbar: {
        show: true,
      },
      height: 'auto',
      zoom: {
        enabled: true,
        type: 'x',
        autoScaleXaxis: true,
      },
      pan: {
        enabled: true,
        type: 'x',
        dragType: 'pan',
      },
      toolbar: {
        autoSelected: 'pan',
      },
    },
    markers: singleDataPoint
      ? {
          size: 6,
        }
      : {},

    colors: ['#181EAC', '#FF4560'],
    dataLabels: {
      enabled: false,
    },
    stroke: {
      curve: 'straight',
      width: 3,
    },
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.7,
        opacityTo: 0.3,
        stops: [0, 100],
      },
    },
    xaxis: useCategory
      ? {
          type: 'category',
          overwriteCategories: filledSeriesData.map((data) =>
            dayjs(data.x).format('MMMM D')
          ), // Ensures categories are overwritten with date strings

          tickAmount: filledSeriesData.length,
        }
      : {
          type: 'datetime',
          tickAmount: undefined,
          labels: {
            format: 'MMMM d',
          },
        },
    yaxis: {
      labels: {
        formatter: function (value) {
          return `$${value.toFixed(2)}`;
        },
      },
    },

    tooltip: {
      x: {
        formatter: function (
          value,
          { series, seriesIndex, dataPointIndex, w }
        ) {
          // Check if using categories for the x-axis
          if (useCategory) {
            // Extract the timestamp from the data and format it
            const timestamp =
              w.config.series[seriesIndex].data[dataPointIndex].x;
            return dayjs(timestamp).format('MMMM D, YYYY');
          } else {
            // Directly use the value for datetime type since it's already formatted
            return dayjs(value).format('MMMM D, YYYY');
          }
        },
      },
    },

    grid: {
      show: true,
    },
    responsive: [
      {
        breakpoint: 480,
      },
    ],
  };

  const series = [
    {
      name: 'Sale Price',
      data: filledSeriesData,
    },
  ];

  return (
    <div className="flex justify-center w-full">
      <div className="w-full lg:h-[400px] xl:h-[475px]">
        <ReactApexChart
          options={options}
          series={series}
          type="area"
          height="400"
        />
      </div>
    </div>
  );
};

export default PriceChartAndStats;
