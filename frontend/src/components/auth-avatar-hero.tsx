"use client"

import React from "react"
import { motion } from "motion/react"

interface AuthAvatarHeroProps {
  headline?: string
  subheadline?: string
}

export function AuthAvatarHero({
  headline = "Meet PennyWise",
  subheadline = "Your intelligent financial copilot that keeps your accounts balanced, accurate, and stress-free.",
}: AuthAvatarHeroProps) {
  return (
    <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-8 text-center my-auto">
      {/* Outer ambient glow and decorative halo rings */}
      <div className="relative flex items-center justify-center">
        <div className="absolute size-72 rounded-full border border-blue-500/20 animate-[spin_45s_linear_infinite]" />
        <div className="absolute size-88 rounded-full border border-dashed border-blue-400/15 animate-[spin_60s_linear_infinite_reverse]" />
        
        {/* Soft radial glow */}
        <div className="absolute size-52 rounded-full bg-blue-500/20 blur-2xl animate-pulse" />

        {/* Avatar presentation card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="relative flex items-center justify-center"
        >
          <div className="relative size-44 sm:size-52 rounded-3xl bg-gradient-to-b from-blue-500/20 via-blue-600/10 to-transparent p-1 border border-blue-400/30 shadow-[0_20px_50px_rgba(13,148,251,0.25)] backdrop-blur-md">
            <div className="size-full rounded-[22px] bg-zinc-900/90 flex items-center justify-center overflow-hidden p-3">
              <img
                src="/penny-wise-avatar.png"
                alt="PennyWise AI Character"
                className="size-full object-contain drop-shadow-[0_12px_24px_rgba(0,0,0,0.6)]"
              />
            </div>
          </div>
        </motion.div>
      </div>

      {/* Identity text */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="mt-6 space-y-2 max-w-sm"
      >
        <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
          {headline}
        </h3>
        <p className="text-xs sm:text-sm leading-relaxed text-zinc-400 font-normal">
          {subheadline}
        </p>
      </motion.div>
    </div>
  )
}
