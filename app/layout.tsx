import { Geist, JetBrains_Mono } from "next/font/google"

import "./globals.css"
import { cn } from "@/lib/utils"
import AppProviders from "@/components/AppProviders"
import { SCHEME_SCRIPT } from "@/lib/themes"

const fontSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontSans.variable,
        "font-mono",
        jetbrainsMono.variable
      )}
    >
      <body>
        {/* Applies the saved site theme before the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: SCHEME_SCRIPT }} />
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}
