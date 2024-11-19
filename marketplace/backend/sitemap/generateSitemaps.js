const { createWriteStream } = require('fs');
const axios = require('axios');
const { default: config } = require('../load.config');
const { default: constants } = require('../helpers/constants');

const url = [
  '/',
  '/c/All',
  '/c/Carbon?sc=CarbonOffset%2CCarbonDAO',
  '/c/Metals?sc=Metals',
  '/c/Clothing?sc=Clothing',
  '/c/Collectibles?sc=Collectibles',
  '/c/Art?sc=Art',
  '/c/Membership?sc=Membership',
  '/checkout',
];

const serverHost = config.serverHost;
const hostname = `${serverHost === constants.localHost ? `${serverHost}:3030` : serverHost}`;
const marketplaceUrl = `${hostname}/api/v1/marketplace?forSale=true&soldOut=true`;

const invalidXMLUnicodeRegex =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u0084\u0086-\u009F\uD800-\uDFFF\uFDD0-\uFDDF\u{1FFFE}-\u{1FFFF}\u{2FFFE}-\u{2FFFF}\u{3FFFE}-\u{3FFFF}\u{4FFFE}-\u{4FFFF}\u{5FFFE}-\u{5FFFF}\u{6FFFE}-\u{6FFFF}\u{7FFFE}-\u{7FFFF}\u{8FFFE}-\u{8FFFF}\u{9FFFE}-\u{9FFFF}\u{AFFFE}-\u{AFFFF}\u{BFFFE}-\u{BFFFF}\u{CFFFE}-\u{CFFFF}\u{DFFFE}-\u{DFFFF}\u{EFFFE}-\u{EFFFF}\u{FFFFE}-\u{FFFFF}\u{10FFFE}-\u{10FFFF}]/gu;

async function fetchInventories() {
  const staticUrls = url.map((item, index) => {
    return {
      url: item,
      changefreq: 'daily',
      priority: 0.5,
      lastmod: new Date().toISOString(),
    };
  });

  try {
    const response = await axios.get(marketplaceUrl);
    const res = response.data;
    if (!res || !res.data || !res.data.productsWithImageUrl) {
      throw new Error('Invalid response or missing data fields');
    }

    const data = res.data.productsWithImageUrl.map(
      ({ address, name }, index) => ({
        url: `/dp/${address}/${name.replace(/[%,\/\\]/g, '-')}`,
        changefreq: 'daily',
        priority: 0.5,
        lastmod: new Date().toISOString(),
      })
    );
    return [...staticUrls, ...data];
  } catch (error) {
    console.error('Error fetching inventories:', error);
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
     ${urls
       .map(
         ({ url, lastmod, changefreq, priority }) => `
     <url>
       <loc>${escapeXML(serverHost + url)}</loc>
       <lastmod>${escapeXML(lastmod)}</lastmod>
       <changefreq>${escapeXML(changefreq)}</changefreq>
       <priority>${escapeXML(priority.toString())}</priority>
     </url>`
       )
       .join('\n')}
     </urlset>`;

  return xml;
}

function escapeXML(str) {
  return str
    .replace(/[<>&'"]/g, function (c) {
      switch (c) {
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '&':
          return '&amp;';
        case "'":
          return '&apos;';
        case '"':
          return '&quot;';
        default:
          return c;
      }
    })
    .replace(invalidXMLUnicodeRegex, '')
    .replace(/ /g, '%20');
}

async function generateSitemap() {
  try {
    const siteMapArr = await fetchInventories();
    const xmlContent = await generateXML(siteMapArr);
    const writeStream = createWriteStream('./public/sitemap.xml');

    writeStream.on('error', (err) => {
      console.error('Error writing to file:', err);
      throw err;
    });

    writeStream.write(xmlContent);
    writeStream.end();

    writeStream.on('finish', () => {
      console.log('Sitemap generated successfully.');
    });
  } catch (error) {
    console.error('Error generating sitemap:', error);
  }
}

module.exports = generateSitemap;
