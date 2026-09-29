import Link from "next/link";
import { CreateDealForm } from "@/components/deals/create-deal-form";

export const dynamic = "force-dynamic";

export default function NewDealPage() {
  return (
    <div className="min-h-screen">
      <main className="page-frame page-form">
        <p className="text-xs font-medium text-ink-muted">
          <Link href="/deals" className="hover:text-ink">Deals</Link>
          <span> / </span>
          <span className="text-ink-secondary">New deal</span>
        </p>
        <h1 className="page-title mt-2">New deal</h1>
        <p className="mb-6 mt-2 text-sm text-ink-secondary">
          A name is enough. You can add documents and messages from the deal workspace.
        </p>
        <CreateDealForm />
      </main>
    </div>
  );
}
