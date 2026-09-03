import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-4 text-center">
      <div className="relative flex size-20 items-center justify-center rounded-3xl bg-blue-50 border border-blue-200 shadow-md overflow-hidden p-2">
        <img
          src="/penny-wise-avatar.png"
          alt="PennyWise"
          className="size-full object-contain"
        />
      </div>
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tabular-nums">404</h1>
        <p className="text-muted-foreground">This page doesn&apos;t exist.</p>
      </div>
      <Link href="/reconciliation/upload">
        <Button>
          Back to Reconciliation
        </Button>
      </Link>
    </div>
  )
}
