"use client"

import * as React from "react"
import Link from "next/link"
import { useAuthStore } from "@/store/authStore"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { ChevronsUpDownIcon, LogOutIcon, LogInIcon } from "lucide-react"

export function NavUser({
  user: initialUser,
}: {
  user?: {
    name: string
    email: string
    avatar?: string
  }
}) {
  const { isMobile } = useSidebar()
  const { user: authUser, logout, isAuthenticated } = useAuthStore()

  const user = authUser || initialUser

  if (!isAuthenticated || !user) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" render={<Link href="/sign-in" />} className="hover:bg-muted">
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-[#0D94FB]/10 text-[#0D94FB]">
              <LogInIcon className="size-4" />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold text-text-primary">Sign in</span>
              <span className="truncate text-xs text-text-muted">Google Account</span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  const initials = user.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : (user.email ? user.email[0].toUpperCase() : "U")

  const picture = ("picture" in user ? (user as any).picture : undefined) || ("avatar" in user ? (user as any).avatar : undefined)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton size="lg" className="aria-expanded:bg-muted" id="sidebar-user-avatar-btn" />
            }
          >
            {picture ? (
              <Avatar className="size-8">
                <AvatarImage src={picture} alt={user.name || user.email} referrerPolicy="no-referrer" />
                <AvatarFallback className="bg-[#0D94FB]/20 text-[#0D94FB] font-bold text-xs">
                  {initials}
                </AvatarFallback>
              </Avatar>
            ) : (
              <div className="size-8 rounded-full bg-[#0D94FB]/20 text-[#0D94FB] flex items-center justify-center text-xs font-bold ring-1 ring-border shrink-0">
                {initials}
              </div>
            )}
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold text-text-primary">{user.name || user.email}</span>
              <span className="truncate text-xs text-text-muted">{user.email}</span>
            </div>
            <ChevronsUpDownIcon className="ml-auto size-4 text-text-muted" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  {picture ? (
                    <Avatar className="size-8">
                      <AvatarImage src={picture} alt={user.name || user.email} referrerPolicy="no-referrer" />
                      <AvatarFallback className="bg-[#0D94FB]/20 text-[#0D94FB] font-bold text-xs">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <div className="size-8 rounded-full bg-[#0D94FB]/20 text-[#0D94FB] flex items-center justify-center text-xs font-bold shrink-0">
                      {initials}
                    </div>
                  )}
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold text-text-primary">{user.name || user.email}</span>
                    <span className="truncate text-xs text-text-muted">{user.email}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              id="sidebar-user-logout"
              onClick={logout}
              className="text-xs text-destructive focus:text-destructive cursor-pointer"
            >
              <LogOutIcon className="mr-2 size-3.5" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
