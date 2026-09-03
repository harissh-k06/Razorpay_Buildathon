"use client"

import Image from "next/image"
import Link from "next/link"
import { motion } from "motion/react"
import { ShieldCheckIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import dynamic from "next/dynamic"

import { useAuthStore } from "@/store/authStore"

const GlobeDemo = dynamic(() => import("@/components/globe-demo"), {
  ssr: false,
})

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.45,
      ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number],
    },
  },
}

import { getApiBaseUrl } from "@/lib/api"

export default function SignInPage() {
  const { devLogin } = useAuthStore()

  const handleGoogleLogin = () => {
    const origin = typeof window !== "undefined" ? window.location.origin : ""
    const query = origin ? `?redirect_to=${encodeURIComponent(origin)}` : ""
    window.location.href = `${getApiBaseUrl()}/api/auth/google${query}`
  }

  return (
    <div className="flex min-h-svh">
      {/* ── Left panel – Globe ── */}
      <div className="relative hidden w-1/2 flex-col justify-between bg-zinc-950 lg:flex">
        {/* Logo */}
        <Link href="/reconciliation/upload" className="relative z-20 flex items-center gap-2.5 p-8">
          <div className="flex size-9 items-center justify-center rounded-xl bg-white/95 border border-white/20 shadow-md overflow-hidden p-0.5">
            <img
              src="/penny-wise-avatar.png"
              alt="PennyWise"
              className="size-full object-contain"
            />
          </div>
          <span className="text-sm font-semibold text-white tracking-tight">PennyWise</span>
        </Link>

        {/* Globe */}
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
          <GlobeDemo />
        </div>

        {/* Quote overlay */}
        <div className="relative z-20 mt-auto p-8">
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm">
            <blockquote className="text-sm leading-relaxed text-white/80">
              &ldquo;Every cent accounted for, every payout verified.&rdquo;
            </blockquote>
            <p className="mt-3 text-xs text-white/50">&mdash; Automated Financial Integrity</p>
          </div>
        </div>
      </div>

      {/* ── Right panel – Google Login ── */}
      <div className="flex flex-1 items-center justify-center bg-background px-6 py-12">
        <motion.div
          className="w-full max-w-sm"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {/* Logo (mobile) */}
          <motion.div
            className="mb-8 flex flex-col items-center lg:hidden"
            variants={itemVariants}
          >
            <div className="flex size-12 items-center justify-center rounded-2xl bg-blue-50 border border-blue-200 shadow-sm overflow-hidden p-1">
              <img
                src="/penny-wise-avatar.png"
                alt="PennyWise"
                className="size-full object-contain"
              />
            </div>
          </motion.div>

          {/* Heading */}
          <motion.div className="text-center" variants={itemVariants}>
            <h1 className="text-2xl font-semibold tracking-tight">
              Welcome to PennyWise
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Sign in with your Google account or continue as demo user
            </p>
          </motion.div>

          {/* Action Buttons */}
          <motion.div className="mt-8 flex flex-col gap-3" variants={itemVariants}>
            <Button
              id="google-signin-btn"
              size="lg"
              variant="outline"
              className="w-full gap-3 h-12 text-sm font-medium border-border hover:bg-surface-1 transition-all duration-200"
              onClick={handleGoogleLogin}
            >
              <Image
                src="/logos/google-com.png"
                alt="Google"
                width={20}
                height={20}
                className="size-5"
              />
              Continue with Google
            </Button>

            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-border"></div>
              <span className="flex-shrink mx-3 text-[11px] text-muted-foreground uppercase tracking-wider">or</span>
              <div className="flex-grow border-t border-border"></div>
            </div>

            <Button
              id="demo-signin-btn"
              size="lg"
              className="w-full h-11 text-xs font-semibold bg-[#0D94FB] hover:bg-[#0D94FB]/90 text-white transition-all duration-200 shadow-sm"
              onClick={() => devLogin()}
            >
              🚀 Continue as Demo User (Instant Access)
            </Button>
          </motion.div>

          {/* Info note */}
          <motion.p
            className="mt-5 text-center text-xs text-muted-foreground/70 leading-relaxed"
            variants={itemVariants}
          >
            By signing in, you allow PennyWise to read your profile and send
            emails on your behalf via Gmail when you choose to resolve exceptions.
          </motion.p>

          {/* Secured badge */}
          <motion.div
            className="mt-8 flex items-center justify-center gap-1.5 text-xs text-muted-foreground/50"
            variants={itemVariants}
          >
            <ShieldCheckIcon className="size-3.5" />
            <span>256-bit SSL encrypted &bull; Powered by Google OAuth 2.0</span>
          </motion.div>
        </motion.div>
      </div>
    </div>
  )
}
