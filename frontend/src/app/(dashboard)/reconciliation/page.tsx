import { redirect } from "next/navigation"
import { PIPELINE_ROUTES } from "@/lib/routes"

export default function ReconciliationPage() {
  redirect(PIPELINE_ROUTES.UPLOAD)
}
