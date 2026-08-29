"use client"

import React from "react"
import { useAuthStore } from "@/store/authStore"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LogOutIcon, UserIcon } from "lucide-react"

export function UserAvatar() {
  const { user, logout, isAuthenticated } = useAuthStore()

  if (!isAuthenticated || !user) return null

  const initials = user.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : user.email[0].toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent transition-colors cursor-pointer outline-none" id="user-avatar-btn" aria-label="User menu">
        {user.picture ? (
          <img
            src={user.picture}
            alt={user.name || user.email}
            className="size-7 rounded-full object-cover ring-1 ring-border"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="size-7 rounded-full bg-[#0D94FB]/20 text-[#0D94FB] flex items-center justify-center text-xs font-bold">
            {initials}
          </div>
        )}
        <div className="hidden sm:flex flex-col items-start leading-tight">
          <span className="text-xs font-semibold text-text-primary truncate max-w-[140px]">
            {user.name || user.email}
          </span>
          <span className="text-[10px] text-text-muted truncate max-w-[140px]">
            {user.email}
          </span>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-0.5">
            <p className="text-xs font-semibold text-text-primary">{user.name}</p>
            <p className="text-[11px] text-text-muted truncate">{user.email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          id="user-menu-logout"
          onClick={logout}
          className="text-xs text-destructive focus:text-destructive cursor-pointer"
        >
          <LogOutIcon className="mr-2 size-3.5" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
