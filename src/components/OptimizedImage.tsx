import { useState, useEffect, useRef, memo } from "react";

/**
 * High-performance image component with:
 * - Intersection Observer lazy loading (only loads when visible)
 * - In-memory cache (avoids re-fetching already loaded URLs)
 * - Preconnect hints for Firebase Storage
 * - Smooth fade-in transition on load
 * - Fallback content on error
 */

// Global in-memory cache of loaded image URLs
const loadedImages = new Set<string>();

// Preconnect to Firebase Storage for faster handshakes
if (typeof window !== "undefined") {
  const domains = [
    "https://firebasestorage.googleapis.com",
    "https://storage.googleapis.com",
  ];
  domains.forEach((href) => {
    if (!document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = href;
      link.crossOrigin = "anonymous";
      document.head.appendChild(link);
    }
  });
}

interface OptimizedImageProps {
  src: string | undefined | null;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
  width?: number;
  height?: number;
}

const OptimizedImage = memo(function OptimizedImage({
  src,
  alt,
  className = "",
  fallback,
  width,
  height,
}: OptimizedImageProps) {
  const [loaded, setLoaded] = useState(() => !!src && loadedImages.has(src));
  const [error, setError] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const imgRef = useRef<HTMLDivElement>(null);

  // Intersection Observer - only start loading when the image is near the viewport
  useEffect(() => {
    if (!src || loadedImages.has(src)) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" } // Start loading 200px before visible
    );

    if (imgRef.current) observer.observe(imgRef.current);
    return () => observer.disconnect();
  }, [src]);

  if (!src || error) {
    return fallback ? <>{fallback}</> : null;
  }

  const alreadyCached = loadedImages.has(src);

  return (
    <div ref={imgRef} className={`relative overflow-hidden ${className}`}>
      {isVisible && (
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading="lazy"
          decoding="async"
          onLoad={() => {
            loadedImages.add(src);
            setLoaded(true);
          }}
          onError={() => setError(true)}
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            alreadyCached || loaded ? "opacity-100" : "opacity-0"
          }`}
          style={{ willChange: "opacity" }}
        />
      )}
    </div>
  );
});

export default OptimizedImage;

/** Eagerly preload critical images into browser cache + memory set */
export function preloadImages(urls: (string | undefined | null)[]) {
  urls.forEach((url) => {
    if (!url || loadedImages.has(url)) return;
    const img = new Image();
    img.onload = () => loadedImages.add(url);
    img.src = url;
  });
}
