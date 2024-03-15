import React from 'react';
import { SEO } from '../../helpers/seoConstant';

const Sitemap = () => {

  return (
          <pre>{
            `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        ${SEO.SEO_ROUTES.map(route => (
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
