import { redirect } from "next/navigation"
import { PIPELINE_ROUTES } from "@/lib/routes"

export default function DashboardRedirect() {
  redirect(PIPELINE_ROUTES.UPLOAD)
}
