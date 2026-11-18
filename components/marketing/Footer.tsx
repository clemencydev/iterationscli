import { Separator } from "@/components/ui/separator"  
import Link from "next/link"  

export default function Footer() {  

  return (  
    <footer data-fractal-window className="w-full border-t border-white/15 bg-black/45 text-white mt-10">  
      <div className="mx-auto max-w-6xl px-6 py-10 flex flex-col gap-6">  
        <div className="flex flex-col md:flex-row justify-between gap-6">  
          <div>  
            <h2 className="text-lg font-semibold">IterationsCLI</h2>  
            <p className="text-sm text-white/60 mt-2">  
              Building simple, fast, and modern web experiences.  
            </p>  
          </div>  
          <div className="flex gap-10">  
            <div className="flex flex-col gap-2 text-sm">  
              <span className="font-medium">Product</span>  
              <Link href="#" className="text-white/60 hover:text-white">  
                Features  
              </Link>  
              <Link href="#" className="text-white/60 hover:text-white">  
                Pricing  
              </Link>  
              <Link href="#" className="text-white/60 hover:text-white">  
                Docs  
              </Link>  
            </div>  
            <div className="flex flex-col gap-2 text-sm">  
              <span className="font-medium">Company</span>  
              <Link href="#" className="text-white/60 hover:text-white">  
                About  
              </Link>  
              <Link href="#" className="text-white/60 hover:text-white">  
                Blog  
              </Link>  
              <Link href="#" className="text-white/60 hover:text-white">  
                Careers  
              </Link>  
            </div>  
          </div>  
        </div>  
        <Separator className="bg-white/15" />  
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-white/60">
          <p>© {new Date().getFullYear()} IterationsCLI. All rights reserved.</p>
          <div className="flex gap-10">  
            <Link href="#" className="text-white/60 hover:text-white">  
              Privacy  
            </Link>  
            <Link href="#" className="text-white/60 hover:text-white">  
              Terms  
            </Link>  
          </div>  
        </div>  
      </div>  
    </footer>  
  )  
}  
