import { useEffect, useState } from "react";

/**
 * The signed-in person's picture, falling back to their initials.
 *
 * Google and LinkedIn both hand back an avatar URL on the profile, and Better
 * Auth stores it on the user record, so this is the real photo rather than a
 * generated one.
 *
 * The fallback is not decoration. LinkedIn's media URLs are time-limited and
 * expire, and a Google image can 404 after a profile change, so an avatar that
 * worked at sign-in can stop resolving mid-session. On any load error this
 * reverts to initials rather than leaving a broken-image glyph where a person's
 * face was.
 */
function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "U"
  );
}

export function Avatar({
  name,
  image,
  className,
}: {
  name: string;
  image?: string;
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  // A different person (or a refreshed URL for the same one) deserves a fresh
  // attempt — without this, one expired URL would keep every later avatar in
  // the fallback state for the life of the component.
  useEffect(() => setFailed(false), [image]);

  const showImage = !!image && !failed;
  return (
    <span className={`${className}${showImage ? " hasimg" : ""}`}>
      {showImage ? (
        <img
          src={image}
          // Decorative: the account name is always rendered or announced
          // alongside this, so alt text here would just repeat it.
          alt=""
          // Google's lh3 host serves avatars only when no referrer is sent,
          // and it keeps the app's URLs out of a third party's logs.
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
