import { useEffect } from "react";
import { SEO_CONFIG, toAbsoluteUrl } from "../Seo/seoConfig";

type SeoProps = {
  title?: string;
  description?: string;
  canonical?: string;
  index?: boolean;
  image?: string;
  type?: "website" | "article";
};

function upsertMetaByName(name: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(
    `meta[name="${name}"]`
  );

  if (!element) {
    element = document.createElement("meta");
    element.setAttribute("name", name);
    document.head.appendChild(element);
  }

  element.setAttribute("content", content);
}

function upsertMetaByProperty(property: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(
    `meta[property="${property}"]`
  );

  if (!element) {
    element = document.createElement("meta");
    element.setAttribute("property", property);
    document.head.appendChild(element);
  }

  element.setAttribute("content", content);
}

function setCanonical(url?: string) {
  let element = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]'
  );

  if (!url) {
    element?.remove();
    return;
  }

  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", "canonical");
    document.head.appendChild(element);
  }

  element.setAttribute("href", url);
}

export default function Seo({
  title = SEO_CONFIG.defaultTitle,
  description = SEO_CONFIG.defaultDescription,
  canonical,
  index = false,
  image = SEO_CONFIG.defaultImage,
  type = "website",
}: SeoProps) {
  useEffect(() => {
    const canonicalUrl = toAbsoluteUrl(canonical);
    const imageUrl = toAbsoluteUrl(image);

    document.title = title;

    upsertMetaByName("description", description);
    upsertMetaByName(
      "robots",
      index
        ? "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1"
        : "noindex,nofollow"
    );

    setCanonical(index ? canonicalUrl : undefined);

    upsertMetaByProperty("og:locale", SEO_CONFIG.locale);
    upsertMetaByProperty("og:site_name", SEO_CONFIG.siteName);
    upsertMetaByProperty("og:type", type);
    upsertMetaByProperty("og:title", title);
    upsertMetaByProperty("og:description", description);

    if (canonicalUrl) {
      upsertMetaByProperty("og:url", canonicalUrl);
    }

    if (imageUrl) {
      upsertMetaByProperty("og:image", imageUrl);
    }

    upsertMetaByName("twitter:card", "summary_large_image");
    upsertMetaByName("twitter:title", title);
    upsertMetaByName("twitter:description", description);

    if (imageUrl) {
      upsertMetaByName("twitter:image", imageUrl);
    }
  }, [title, description, canonical, index, image, type]);

  return null;
}
