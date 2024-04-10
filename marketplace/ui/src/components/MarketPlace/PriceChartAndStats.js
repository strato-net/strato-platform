import React from 'react';
import ReactApexChart from 'react-apexcharts';

const PriceChartAndStats = ({ isFetchingPriceHistory, priceHistory }) => {
  if (isFetchingPriceHistory || !priceHistory || !priceHistory.originRecords || priceHistory.originRecords.length === 0) {
    return <div className="h-full bg-gray-200 animate-pulse"></div>;
  }


  const series = [
    {
      name: 'Origin Price',
      data: priceHistory.originRecords.map(record => {
        try {
          // Replace spaces with 'T' and ' UTC' with 'Z' (ISO 8601)
          const isoDate = record.block_timestamp.replace(' ', 'T').replace(' UTC', 'Z');
          const parsedDate = new Date(isoDate);
          const timestamp = parsedDate.getTime();
  
          if (isNaN(timestamp)) {
            throw new Error('Invalid date');
          }
  
          return {
            x: timestamp,
            y: record.price,
          };
        } catch (error) {
          console.error('Error parsing date:', record.block_timestamp, error);
          return null;
        }
      }).filter(point => point !== null), // Filter out any invalid points
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
      <h2 className='w-full text-center font-bold text-2xl'>Price History</h2>

    <div className="flex justify-center w-full h-full">
      <div className="w-full h-full lg:h-[500px] xl:h-[600px]">
        <ReactApexChart options={options} series={series} type="area" height="400" />
      </div>
    </div>
    </div>

  );
};

export default PriceChartAndStats;


