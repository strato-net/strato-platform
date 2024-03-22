import { createWriteStream } from 'fs';
import axios from 'axios';

const url = [
       "/",
       "/c/all",
       "/c/Carbon?sc=CarbonOffset%2CCarbonDAO",
       "/c/Metals?sc=Metals",
       "/c/Clothing?sc=Clothing",
       "/c/Collectibles?sc=Collectibles",
       "/c/Art?sc=Art",
       "/c/Membership?sc=Membership",
       "/checkout",
      ]

const hostname = 'https://marketplace.mercata.blockapps.net';
const marketplaceUrl = `${hostname}/api/v1/marketplace`;

async function fetchInventories() {

  const staticUrls = url.map((item,index)=>{
    return { url: item, changefreq: "daily", priority: 0.5, lastmod: new Date().toISOString() };
  })

    try {
        const response = await axios.get(marketplaceUrl);
        const res = response.data;
        const data = res?.data.productsWithImageUrl?.map((item, index) => {
            return { url: `/dp/${item.address}/${item.name}`, changefreq: "daily", priority: 0.5, lastmod: new Date().toISOString() };
        });
        return [...staticUrls, ...data];
    } catch (error) {
        console.error("Error fetching inventories:", error);
        throw error;
    }
}

async function generateXML(urls) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
     <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
     xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
     xmlns:xhtml="http://www.w3.org/1999/xhtml"
     xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
     xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
     ${urls.map(url => `
     <url>
       <loc>${escapeXML(hostname + url.url)}</loc>
       <lastmod>${url.lastmod}</lastmod>
       <changefreq>${url.changefreq}</changefreq>
       <priority>${url.priority}</priority>
     </url>`).join('\n')}
     </urlset>`;
     
    return xml;
  }

function escapeXML(str) {
  return str.replace(/[<>&'"]/g, function (c) {
      switch (c) {
          case '<': return '&lt;';
          case '>': return '&gt;';
          case '&': return '&amp;';
          case '\'': return '&apos;';
          case '"': return '&quot;';
      }
  });
}

async function generateSitemap() {
    try {
        const siteMapArr = await fetchInventories();
        const xmlContent = await generateXML(siteMapArr);
        const writeStream = createWriteStream('../ui/public/sitemap.xml');
        writeStream.write(xmlContent);
        writeStream.end();
        console.log('Sitemap generated successfully.');
    } catch (error) {
        console.error('Error generating sitemap:', error);
    }
}

export default generateSitemap;
