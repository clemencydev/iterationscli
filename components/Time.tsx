import { useEffect, useState } from "react"

const format = (now: Date) =>
  [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":")

export default function Time() {
  // Empty until the page is in the browser: the server cannot know the
  // visitor's clock, and guessing made the whole page render twice.
  const [currentTime, setCurrentTime] = useState("")

  useEffect(() => {
    const tick = () => setCurrentTime(format(new Date()))
    const first = setTimeout(tick, 0)
    const timer = setInterval(tick, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [])

  return (
    <div className="flex items-center justify-center">
      <div className="flex-col ">
        <div className=" text-gray-400 mt-4 text-5xl mt-10">
          {currentTime || " "}
        </div>
      </div>
    </div>
  )
}
