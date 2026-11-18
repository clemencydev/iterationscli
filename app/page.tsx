"use client"

import Hero from "@/components/marketing/Hero"
import Features from "@/components/marketing/Features"
import Time from "@/components/Time"
import Footer from "@/components/marketing/Footer"
import Mandelbrot from "@/components/marketing/Mandelbrot"
export default function Page() {
  return (
    // The fractal is fixed behind the whole page. The clock, hero and footer
    // are transparent so it shows through them; the features band covers it.
    <div className="relative isolate">
      <Mandelbrot />
      <div className="flex justify-center" data-fractal-window>
        <div className="flex-col ">
          <Time />
        </div>
      </div>
      <Hero />
        <div className="h-1/2 bg-white">
          <Features />
        </div>
      <Footer />
    </div >
  )
}
