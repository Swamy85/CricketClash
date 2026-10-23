
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export default function HashScroll() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (!hash) return;

    const sectionId = decodeURIComponent(hash.slice(1));

    // Wait for the destination page to render.
    const frameId = requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });

    return () => cancelAnimationFrame(frameId);
  }, [pathname, hash]);

  return null;
}
