"use client"

import * as React from "react"
import Link from "next/link"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  UploadCloudIcon, SparklesIcon, ScanSearchIcon,
  BarChart3Icon, SettingsIcon, LandmarkIcon,
} from "lucide-react"

const data = {
  user: {
    name: "Finance Controller",
    email: "controller@company.com",
    avatar: "/avatars/user.jpg",
  },
  navReconciliation: [
    { title: "Upload Files",  url: "/reconciliation/upload",      icon: <UploadCloudIcon className="size-4" /> },
    { title: "Standardize",   url: "/reconciliation/standardize", icon: <SparklesIcon className="size-4" /> },
    { title: "Review",        url: "/reconciliation/review",      icon: <ScanSearchIcon className="size-4" /> },
    { title: "Results",       url: "/reconciliation/results",     icon: <BarChart3Icon className="size-4" /> },
  ],
  navSystem: [
    { title: "Settings", url: "/settings", icon: <SettingsIcon className="size-4" /> },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/reconciliation/upload" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <LandmarkIcon className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">PennyWise</span>
                <span className="truncate text-xs text-muted-foreground">Your Khata Agent</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <NavMain items={data.navReconciliation} label="Reconciliation" />
        <NavMain items={data.navSystem} label="System" />
      </SidebarContent>

      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  )
}
