const paths = {
  select: "M4 3v16l5-5 4 7 3-2-4-6h7z",
  eraser: "m3 14 10-11 8 8-10 10H9zM8 9l8 8M11 21h10",
  pen: "m15 4 5 5M4 20l4-1L20 7a2 2 0 0 0-3-3L5 16z",
  hand: "M8 12V6a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v9c0 4-3 6-6 6h-1c-2 0-4-1-5-3l-5-6a2 2 0 0 1 3-2l2 2",
  sticky: "M4 3h16v12l-5 6H4zM14 21v-7h6",
  kanban: "M3 4h18v16H3zM9 4v16M15 4v16M5 8h2M11 8h2M17 8h2M5 12h2M11 12h2",
  arrow: "M4 19 20 5M10 5h10v10",
  document: "M5 3h9l5 5v13H5zM14 3v6h5M8 13h8M8 17h8",
  text: "M5 7V4h14v3M12 4v16M9 20h6",
  file: "M6 3h8l5 5v13H6zM14 3v5h5M9 17l3-4 2 2 2-3",
  link: "M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1",
  undo: "M9 4 3 10l6 6M3 10h11a6 6 0 0 1 6 6v4",
  lock: "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3",
  unlock: "M7 10V7a5 5 0 0 1 10-1M5 10h14v11H5zM12 14v3",
  delete: "M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7",
  grip: "M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01",
  open: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6 6 18",
}
export type BoardIconName = keyof typeof paths
export default function BoardIcon({
  name,
  size = 18,
}: {
  name: BoardIconName
  size?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "grip" ? 3 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}
