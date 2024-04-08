import React from 'react';
import ReactApexChart from 'react-apexcharts';
import { format } from 'date-fns';

const PriceChartAndStats = ({ isFetchingPriceHistory, priceHistory }) => {
  if (isFetchingPriceHistory || !priceHistory || !priceHistory.records || priceHistory.records.length === 0 || !priceHistory.originRecords || priceHistory.originRecords.length === 0) {
    return <div className="h-full bg-gray-200 animate-pulse"></div>;
  }


  
  const series = [
  {
    name: 'Origin Price',
    data: priceHistory.originRecords.map(record => ({
      x: new Date(record.block_timestamp).getTime(), // Convert to timestamp
      y: record.price,
    }))
  }
];

  const options = {
    chart: {
      type: 'area',
      toolbar: {
        show: false
      },
      height: 'auto', // Responsive height
      zoom: {
        enabled: true, // Enable zooming
        type: 'x', // Specify the type of zoom (x, y, xy)
      },
      autoSelected: 'selection',
      toolbar: {
        autoSelected: 'zoom' // Default tool selected in the toolbar ('zoom', 'selection', 'pan', or 'none')
      }
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
        formatter: function(value) {
          // Format the date to a more readable form like 'March 12'
          // return format(new Date(value), 'MMMM d');
          return format(new Date(value), 'MMMM d');
        }
      },
      axisBorder: {
        show: false
      },
      axisTicks: {
        show: false
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
      <h2 className='w-full text-center font-bold text-xl'>Price History</h2>

    <div className="flex justify-center w-full h-full">
      <div className="w-full h-full lg:h-[500px] xl:h-[600px]">
        <ReactApexChart options={options} series={series} type="area" height="400" />
      </div>
    </div>
    </div>

  );
};

export default PriceChartAndStats;


