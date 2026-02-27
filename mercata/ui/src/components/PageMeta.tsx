import { Helmet } from "react-helmet-async";

const DEFAULT_DESCRIPTION =
  "Diverse asset classes, one platform. From crypto to precious metals to tokenized securities — investing made simple for everyone.";

interface PageMetaProps {
  title: string;
  description?: string;
  image?: string;
  url?: string;
}

const PageMeta = ({ title, description, image, url }: PageMetaProps) => {
  const appUrl = "https://app.strato.nexus";
  const ogImage = image || `${appUrl}/marketplaceBG.png`;
  const ogDescription = description || DEFAULT_DESCRIPTION;

  return (
    <Helmet>
      <title>{title}</title>
      <meta property="og:title" content={title} />
      <meta property="og:description" content={ogDescription} />
      <meta property="og:image" content={ogImage} />
      {url && <meta property="og:url" content={url} />}
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={ogDescription} />
      <meta name="twitter:image" content={ogImage} />
    </Helmet>
  );
};

export default PageMeta;
