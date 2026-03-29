"use client";

import type { ButtonHTMLAttributes } from "react";
import { ProfileAvatarImage } from "@/components/ProfileAvatarImage";
import { profilePictureDisplayUrl, userInitialsFromName } from "@/lib/profilePicture";

type Props = {
  pictureUrl?: string | null;
  name: string;
  email?: string;
  className?: string;
  imgClassName?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "type">;

export function UserAvatarNavButton({
  pictureUrl,
  name,
  email,
  className,
  imgClassName,
  ...rest
}: Props) {
  const src = profilePictureDisplayUrl(pictureUrl);
  const initials = userInitialsFromName(name, email);
  return (
    <button type="button" className={className} {...rest}>
      {src ? (
        <ProfileAvatarImage className={imgClassName} src={src} alt="" width={38} height={38} />
      ) : (
        initials
      )}
    </button>
  );
}
