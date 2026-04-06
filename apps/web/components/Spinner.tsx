import s from "./Spinner.module.css";

type Props = {
  size?: number;
  className?: string;
  label?: string;
};

export function Spinner({ size = 24, className, label = "Loading…" }: Props) {
  return (
    <span
      className={`${s.spinner} ${className ?? ""}`}
      role="status"
      aria-label={label}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle className={s.track} cx="12" cy="12" r="10" strokeWidth="3" />
        <path
          className={s.arc}
          d="M22 12a10 10 0 0 0-10-10"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
