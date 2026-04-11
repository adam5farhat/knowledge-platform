"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Formats a date with Intl after mount only. Server + first client paint both render
 * empty/nbsp so hydration matches; avoids React #418 from Node vs browser locale output.
 */
export function ClientLocaleDate({
  iso,
  mode = "datetime",
  options,
  className,
  invalid = "—",
}: {
  iso: string;
  mode?: "datetime" | "date";
  options?: Intl.DateTimeFormatOptions;
  className?: string;
  invalid?: string;
}) {
  const [text, setText] = useState("");
  const optsKey = useMemo(() => JSON.stringify(options ?? null), [options]);

  useEffect(() => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      setText(invalid);
      return;
    }
    const o = options ?? undefined;
    setText(mode === "date" ? d.toLocaleDateString(undefined, o) : d.toLocaleString(undefined, o));
  }, [iso, mode, optsKey, invalid]);

  return <span className={className}>{text || "\u00a0"}</span>;
}

/** Same as ClientLocaleDate but renders a `<time dateTime={iso}>`. */
export function ClientLocaleTime({
  iso,
  mode = "datetime",
  options,
  className,
  invalid = "—",
}: {
  iso: string;
  mode?: "datetime" | "date";
  options?: Intl.DateTimeFormatOptions;
  className?: string;
  invalid?: string;
}) {
  const [text, setText] = useState("");
  const optsKey = useMemo(() => JSON.stringify(options ?? null), [options]);

  useEffect(() => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      setText(invalid);
      return;
    }
    const o = options ?? undefined;
    setText(mode === "date" ? d.toLocaleDateString(undefined, o) : d.toLocaleString(undefined, o));
  }, [iso, mode, optsKey, invalid]);

  return (
    <time dateTime={iso} className={className}>
      {text || "\u00a0"}
    </time>
  );
}
