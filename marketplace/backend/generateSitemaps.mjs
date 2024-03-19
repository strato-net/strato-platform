import { SitemapStream, streamToPromise } from 'sitemap';
import { createWriteStream } from 'fs';
import fetch from 'node-fetch';

let urls = [
   { url: "/", changefreq: "weekly", priority: 0.5 },
   { url: "/c/all", changefreq: "weekly", priority: 0.5 },
   { url: "/c/Carbon?sc=CarbonOffset%2CCarbonDAO", changefreq: "weekly", priority: 0.5 },
   { url: "/c/Metals?sc=Metals", changefreq: "weekly", priority: 0.5 },
   { url: "/c/Clothing?sc=Clothing", changefreq: "weekly", priority: 0.5 },
   { url: "/c/Collectibles?sc=Collectibles", changefreq: "weekly", priority: 0.5 },
   { url: "/c/Art?sc=Art", changefreq: "weekly", priority: 0.5 },
   { url: "/c/Membership?sc=Membership", changefreq: "weekly", priority: 0.5 },
  //  { url: "/dp/:address/:name", changefreq: "weekly", priority: 0.5 },
   { url: "/checkout", changefreq: "weekly", priority: 0.5 },
]

// change hostname
const hostname = 'https://marketplace.mercata.blockapps.net'
const stream = new SitemapStream({ hostname });
const marketplaceUrl = `${hostname}/api/v1/marketplace`

async function fetchInventories() {
    try {
        const response = await fetch(marketplaceUrl);
        const res = await response.json();
        res?.data.productsWithImageUrl?.forEach((item,index)=>{
          urls.push({ url: `/dp/${item.address}/${item.name}`, changefreq: "weekly", priority: 0.9 })
        });
        return res.data;
    } catch (error) {
        console.error("Error fetching inventories:", error);
        throw error; 
    }
}

async function generateSitemap() {
  try {
    await fetchInventories();
    urls.forEach(url => {
      stream.write(url);
    });
    stream.end();

    const writeStream = createWriteStream('sitemap.xml');
    stream.pipe(writeStream);

    await streamToPromise(stream);
    console.log('Sitemap generated successfully.');
  } catch (error) {
    console.error('Error generating sitemap:', error);
  }
}

generateSitemap();
