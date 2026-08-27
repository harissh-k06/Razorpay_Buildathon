import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  fallback: ["Arial", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "Liberation Mono", "Courier New", "monospace"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://shadcn-fintech.vercel.app"),
  title: "Razorpay Blade — Finance Dashboard",
  description: "A premium fintech dashboard built with Next.js, shadcn/ui, and the Razorpay design system (Blade).",
  openGraph: {
    title: "Razorpay Blade — Finance Dashboard",
    description: "A premium fintech dashboard built with Next.js, shadcn/ui, and the Razorpay design system (Blade).",
    type: "website",
    url: "https://shadcn-fintech.vercel.app",
    images: [{ url: "/screenshots/shadcn-fintech.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Razorpay Blade — Finance Dashboard",
    description: "A premium fintech dashboard built with Next.js, shadcn/ui, and the Razorpay design system (Blade).",
    images: ["/screenshots/shadcn-fintech.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased font-sans`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        <TooltipProvider>
          {children}
          <Toaster />
        </TooltipProvider>
      </body>
    </html>
  );
}
