/** A flat, decorative composition with a shared light/dark palette. */
export function WorkbenchScene() {
  return (
    <svg
      className="workbench-scene"
      viewBox="0 0 640 520"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="320" cy="257" r="179" fill="var(--workbench-halo)" />
      <rect
        x="288"
        y="155"
        width="190"
        height="254"
        rx="27"
        transform="rotate(12 383 282)"
        fill="var(--workbench-blue)"
      />
      <g transform="rotate(-9 271 248)">
        <rect
          x="151"
          y="100"
          width="240"
          height="296"
          rx="28"
          fill="var(--workbench-paper)"
          stroke="var(--workbench-line)"
          strokeWidth="2"
        />
        <circle cx="222" cy="176" r="27" fill="var(--workbench-blue)" />
        <path
          d="M198 248h145M198 272h145M198 296h91"
          stroke="var(--workbench-line)"
          strokeWidth="8"
          strokeLinecap="round"
        />
        <path
          d="M198 349h35"
          stroke="var(--workbench-blue)"
          strokeWidth="8"
          strokeLinecap="round"
        />
      </g>
      <circle
        cx="470"
        cy="129"
        r="17"
        stroke="var(--workbench-blue)"
        strokeWidth="3"
      />
      <path
        d="M136 363v18m-9-9h18"
        stroke="var(--workbench-line)"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
