"use client";

import type { HTMLAttributeReferrerPolicy } from "react";

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
      style={{ objectFit: "cover", borderRadius: "50%" }}
    />
  );
}
