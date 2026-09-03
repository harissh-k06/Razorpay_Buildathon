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
  BarChart3Icon,
} from "lucide-react"
import { PIPELINE_ROUTES } from "@/lib/routes"

const data = {
  navReconciliation: [
    { title: "Upload Files",  url: PIPELINE_ROUTES.UPLOAD,      icon: <UploadCloudIcon className="size-4" /> },
    { title: "Standardize",   url: PIPELINE_ROUTES.STANDARDIZE, icon: <SparklesIcon className="size-4" /> },
    { title: "Review",        url: PIPELINE_ROUTES.REVIEW,      icon: <ScanSearchIcon className="size-4" /> },
    { title: "Results",       url: PIPELINE_ROUTES.RESULTS,     icon: <BarChart3Icon className="size-4" /> },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href={PIPELINE_ROUTES.UPLOAD} />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg overflow-hidden border border-blue-200/80 bg-blue-50/60 shadow-xs shrink-0">
                <img
                  src="/penny-wise-avatar.png"
                  alt="PennyWise"
                  className="size-full object-cover"
                />
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
      </SidebarContent>

      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
