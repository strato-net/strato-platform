import React from 'react';
import ReactApexChart from 'react-apexcharts';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

const PriceChartAndStats = ({ isFetchingPriceHistory, priceHistory }) => {
  if (isFetchingPriceHistory || !priceHistory || !priceHistory.originRecords || priceHistory.originRecords.length === 0) {
    return <div className="h-full bg-gray-200 animate-pulse"></div>;
  }

  const fillDataGaps = (records) => {
    if (records.length === 1) {
      return [{
        x: dayjs(records[0].block_timestamp.replace(' UTC', 'Z')).valueOf(),
        y: records[0].price,
      }];
    }

    const filledData = [];
    let lastKnownPrice = null;
  
    records.forEach((currentRecord, i) => {
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
    });
  
      // // Fill the gap until the current date with the last known price
      // let currentDate = dayjs(filledData[filledData.length - 1].x).add(1, 'day');
      // const today = dayjs().utc().endOf('day');
      // while (currentDate.isBefore(today, 'day')) {
      //   filledData.push({
      //     x: currentDate.valueOf(),
      //     y: lastKnownPrice,
      //   });
      //   currentDate = currentDate.add(1, 'day');
      // }

    return filledData;
  };
  

  // Fill in the gaps in the original records
  const filledSeriesData = fillDataGaps(priceHistory.originRecords);

  const series = [
    {
      name: 'Sale Price',
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


