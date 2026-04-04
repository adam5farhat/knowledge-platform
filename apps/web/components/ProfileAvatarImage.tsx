"use client";

import { useCallback, useState, type HTMLAttributeReferrerPolicy } from "react";

type Props = {
  src: string;
  alt?: string;
  width: number;
  height: number;
  className?: string;
  /** Kept for call-site compatibility; avatars use native `<img>` (not `next/image`). */
  sizes?: string;
  title?: string;
  referrerPolicy?: HTMLAttributeReferrerPolicy;
};

/**
 * Profile photos via `<img>`. Using `next/image` here previously correlated with Next 15 dev webpack
 * errors (`__webpack_modules__[moduleId] is not a function`) when loading RSC flight data.
 * Falls back to initials circle when the image fails to load (e.g. ad-blockers).
 */
export function ProfileAvatarImage({
  src,
  alt = "",
  width,
  height,
  className,
  title,
  referrerPolicy = "no-referrer",
}: Props) {
  const [failed, setFailed] = useState(false);
  const onError = useCallback(() => setFailed(true), []);

  if (failed || !src) {
    const initials = (alt || title || "?")
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join("");
    return (
      <span
        className={className}
        title={title}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width,
          height,
          borderRadius: "50%",
          background: "#e4e4e7",
          color: "#52525b",
          fontSize: Math.round(width * 0.38),
          fontWeight: 600,
          userSelect: "none",
        }}
        aria-hidden
      >
        {initials}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      title={title}
      referrerPolicy={referrerPolicy}
      decoding="async"
      onError={onError}
      style={{ objectFit: "cover", borderRadius: "50%" }}
    />
  );
}
