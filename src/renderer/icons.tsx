export function ChevronIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d={direction === "up" ? "M4 9.8 8 5.8l4 4" : "M4 6.2 8 10.2l4-4"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const GEAR_PATH =
  "M12.77 6.9 L14.81 6.86 L14.81 9.14 L12.77 9.1 A4.9 4.9 0 0 1 12.16 10.6 L13.62 12.01 L12.01 13.62 " +
  "L10.6 12.16 A4.9 4.9 0 0 1 9.1 12.77 L9.14 14.81 L6.86 14.81 L6.9 12.77 A4.9 4.9 0 0 1 5.4 12.16 " +
  "L3.99 13.62 L2.38 12.01 L3.84 10.6 A4.9 4.9 0 0 1 3.23 9.1 L1.19 9.14 L1.19 6.86 L3.23 6.9 " +
  "A4.9 4.9 0 0 1 3.84 5.4 L2.38 3.99 L3.99 2.38 L5.4 3.84 A4.9 4.9 0 0 1 6.9 3.23 L6.86 1.19 " +
  "L9.14 1.19 L9.1 3.23 A4.9 4.9 0 0 1 10.6 3.84 L12.01 2.38 L13.62 3.99 L12.16 5.4 " +
  "A4.9 4.9 0 0 1 12.77 6.9 Z " +
  "M8 5.6 A2.4 2.4 0 1 0 8 10.4 A2.4 2.4 0 1 0 8 5.6 Z";

export function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d={GEAR_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
