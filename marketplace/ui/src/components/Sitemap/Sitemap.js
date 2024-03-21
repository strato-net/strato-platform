import React, { useEffect, useState } from 'react';
import { SEO } from '../../helpers/seoConstant';

const Sitemap = () => {
  const apiUrl = process.env.REACT_APP_URL
  const marketplaceUrl = `${apiUrl}/api/v1/marketplace`;
  const [data, setData] = useState([]);

  const fetchData = async (marketplaceUrl) => {
    try {
      const response = await fetch(marketplaceUrl);
      const res = await response.json();
      const data = res?.data.productsWithImageUrl?.map((item, index) => ({
        url: `/dp/${item.address}/${item.name}`,
        changefreq: "daily",
        priority: 0.5,
        lastmod: Date.now(),
      }));
      setData(data)
      return data;
    } catch (error) {
      console.error("Error fetching data:", error);
      return null;
    }
  };
  
  useEffect(()=>{
    fetchData(marketplaceUrl)
    .then(data => {
      console.log("Fetched data:");
    })
    .catch(error => console.error("Error:", error));
  },[])

  return (
          <pre>{
            `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        ${[...SEO.SEO_ROUTES, ...data].map(route => (
          `<url>
            <loc>${route.url}</loc> 
            <lastmod>${new Date().toISOString()}</lastmod>
            <changefreq>${route.changefreq}</changefreq>
            <priority>${route.priority}</priority>
          </url>`
        )).join('')}
      </urlset>`
            }</pre>
  );
}

export default Sitemap;
