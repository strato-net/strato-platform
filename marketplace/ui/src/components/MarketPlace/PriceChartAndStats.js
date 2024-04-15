import React from 'react';
import ReactApexChart from 'react-apexcharts';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

const PriceChartAndStats = ({ isFetchingPriceHistory, priceHistory }) => {
  if (isFetchingPriceHistory || !priceHistory || !priceHistory.originRecords || priceHistory.originRecords.length === 0) {
    return <div className="h-full bg-gray-200 animate-pulse"></div>;
  }

  // Helper function to fill gaps in the data
  const fillDataGaps = (records) => {
    const filledData = [];
    let lastKnownPrice = null;

    records.forEach((record, index) => {
      // Parse the date and price
      const isoDate = record.block_timestamp.replace(' UTC', 'Z');
      const date = dayjs(isoDate).utc();
      const price = record.price;

      // If this is the first record, set the last known price
      if (index === 0) {
        lastKnownPrice = price;
      }

      // Push the current record
      filledData.push({
        x: date.valueOf(),
        y: price,
      });

      // If there's a next record, fill the gap between the current and the next record
      if (index < records.length - 1) {
        const nextIsoDate = records[index + 1].block_timestamp.replace(' UTC', 'Z');
        const nextDate = dayjs(nextIsoDate).utc();
        let currentDate = date.add(1, 'day');

        // Fill in the gaps
        while (currentDate.isBefore(nextDate, 'day')) {
          filledData.push({
            x: currentDate.valueOf(),
            y: lastKnownPrice,
          });
          currentDate = currentDate.add(1, 'day');
        }
      }

      // Update the last known price
      lastKnownPrice = price;
    });

    return filledData;
  };

  // Fill in the gaps in the original records
  const filledSeriesData = fillDataGaps(priceHistory.originRecords);

  const series = [
    {
      name: 'Origin Price',
      data: filledSeriesData,
    },
  ];
  

  const options = {
    chart: {
      type: 'area',
      toolbar: {
        show: true
      },
      height: 'auto', // Responsive height
      zoom: {
        enabled: true, // Enable zooming
        type: 'x', // Specify the type of zoom (x - horizontal, y - vertical, xy - both)
        autoScaleXaxis: true // Automatically scale the Y axis as the chart zooms in and out
      },
      pan: {
        enabled: true, // Enable panning
        type: 'x', // Allow panning in horizontal direction
        dragType: 'pan'
      },
      toolbar: {
        autoSelected: 'pan' // Default tool selected in the toolbar ('zoom', 'selection', 'pan', or 'none')
      }
    },
    tools: {
      download: true, // Show the download icon
      selection: true, // Show the selection icon for zooming in
      zoom: true, // zoom in icon
      zoomin: false, // zoom in icon
      zoomout: false, //  zoom out icon
      pan: true, // allow panning
      reset: true // Show the home icon for resetting the zoom
    },
    colors: ['#181EAC', '#FF4560'],
    dataLabels: {
      enabled: false
    },
    stroke: {
      curve: 'smooth',
      width: 3
    },
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.7,
        opacityTo: 0.3,
        stops: [0, 100]
      }
    },
    xaxis: {
      type: 'datetime',
      range: undefined,
      tickPlacement: 'on',
      labels: {
        format: 'MMMM d', 
      },
      axisBorder: {
        show: false
      },
      axisTicks: {
        show: true
      }
    },
    
    yaxis: {
      labels: {
        formatter: function(value) {
          return `$${value}`
        }
      },
      axisBorder: {
        show: false
      },
    },
    tooltip: {
      x: {
        format: 'MMMM d, yyyy' // Full date format for the tooltip
      }
    },
    responsive: [{
      breakpoint: 480,
    }],
    grid: {
      show: true
    }
  };

  

  return (
    <div>
      <div className="flex justify-center w-full">
        <div className="w-full lg:h-[400px] xl:h-[475px]">
        <ReactApexChart options={options} series={series} type="area" height="400" />
      </div>
    </div>
    </div>

  );
};

export default PriceChartAndStats;


